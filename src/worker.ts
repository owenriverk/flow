/**
 * Cloudflare Email Worker entry point.
 *
 * Bound as the catch-all action on lateboof.com Email Routing. Decodes the inbound
 * MIME, then hands the plain-text body to the tested core. Reply paths:
 *   - InReach (body has an inreachlink token) → Garmin web-form POST.
 *   - normal email → message.reply() (also lets you test from a laptop).
 * Fuzzy run-name matching falls back to Workers AI, but only on a lookup miss and
 * only while under the daily call cap (keeps us inside the free neuron tier).
 *
 * Both reply paths are wrapped: on every failure a notification goes to the owner's
 * Gmail (via the SEND_EMAIL binding) with enough info to manually respond to the
 * paddler, and the outcome is recorded via src/statusTracking.ts. If InReach
 * failures start stacking up with no success in between (Garmin changed the form,
 * most likely) a second, escalated alert fires — see shouldEscalate. The same
 * tracked state is served as JSON from fetch() for status.html to read.
 *
 * This is the only file that touches the Workers runtime; everything it calls is
 * unit-tested.
 */

import { EmailMessage } from 'cloudflare:email';
import { createMimeMessage } from 'mimetext';
import PostalMime from 'postal-mime';
import { handleInbound } from './handleInbound.js';
import { replyToInreach as defaultReplyToInreach } from './replyToInreach.js';
import { aiResolve, type AiBinding } from './aiResolve.js';
import { claimAiCall, DAILY_AI_CAPS, type KvLike } from './budget.js';
import { fetchCachedReading } from './supabaseCache.js';
import { logQuery } from './queryLog.js';
import { looksLikeSpam } from './spamFilter.js';
import { runNightlyChecks, type NightlyCheck } from './canaryRunner.js';
import { buildSweepCheck, buildTrendHealthCheck, buildWatchdogCheck } from './canarySweep.js';
import { buildGarminCheck } from './canaryGarmin.js';
import { cacheInboundToken, isCanaryMessage } from './canaryHelpers.js';
import { parseInbound } from './parseInbound.js';
import { handleQuery, NOT_FOUND, UNAVAILABLE } from './handleQuery.js';
import {
  validateTwilioSignature,
  claimMessageSid,
  parseSmsWebhook,
  isOptOutOrHelp,
  twimlMessage,
  twimlEmpty,
} from './sms.js';
import { senderKey, checkSmsThrottle, claimOwnerAlert } from './smsThrottle.js';
import { buildReplyHeaders } from './emailReply.js';
import {
  recordReplySuccess,
  recordReplyFailure,
  shouldEscalate,
  getStatusSummary,
} from './statusTracking.js';
import aliasesJson from './aliases.json' with { type: 'json' };
import type { GaugeAlias, GaugeSource } from './lookupGauge.js';

const aliases = aliasesJson as Record<string, GaugeAlias>;

// Daily AI-call caps now live with the counter that enforces them, split per
// ingress so SMS traffic cannot exhaust the email path's allowance — see
// src/budget.ts (DAILY_AI_CAPS) for the neuron math and the rationale.

const OWNER_EMAIL = 'okurthdev@gmail.com';
// Fixed sender for owner alerts — deliberately not message.to, since the catch-all
// means that could be any address @lateboof.com a paddler happens to type.
const BOT_EMAIL = 'flow@lateboof.com';
// Reuses the AI-call-budget KV namespace under a separate "status:" key prefix
// (see src/statusTracking.ts) rather than provisioning a second namespace for what
// is, from the Worker's side, just more small counters.
const STATUS_ENDPOINT_PATH = '/api/status';
// Twilio inbound-SMS webhook. Bound to lateboof.com/api/sms via `routes` in
// wrangler.jsonc, beside the status endpoint. Distinct from the static /sms
// opt-in page, which stays on the static site.
const SMS_ENDPOINT_PATH = '/api/sms';

interface Env {
  AI: Ai;
  AI_BUDGET: KVNamespace;
  SEND_EMAIL: SendEmail;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  // Canary identity — both set via `wrangler secret put` (never committed; the
  // repo is public). Unset => canary detection is dormant and every email is
  // treated as real traffic. See src/canaryHelpers.ts.
  CANARY_FROM?: string;
  CANARY_SECRET?: string;
  // Twilio account auth token — set via `wrangler secret put TWILIO_AUTH_TOKEN`
  // (never committed; the repo is public). Validates inbound SMS webhook
  // signatures, and doubles as the HMAC key that makes stored sender ids opaque
  // (src/smsThrottle.ts). Unset => every SMS webhook is rejected (fail closed).
  TWILIO_AUTH_TOKEN?: string;
  // The owner's own mobile number in Twilio's E.164 form (e.g. +15551234567),
  // exempted from the per-sender SMS throttle. A secret rather than a var because
  // the repo is public and this is a personal phone number. Optional: unset means
  // no exemption, and the throttle simply applies to everyone.
  SMS_OWNER_NUMBER?: string;
}

// Plain-text alert to the owner, usable both from the email handler and from the
// failure-escalation path (which has no inbound message to build a reply-to from).
// Errors are swallowed by callers so a broken notification path can't mask the
// original failure.
async function notifyOwner(env: Env, subject: string, text: string): Promise<void> {
  const msg = createMimeMessage();
  msg.setSender({ name: 'LateBoof', addr: BOT_EMAIL });
  msg.setRecipient(OWNER_EMAIL);
  msg.setSubject(subject);
  msg.addMessage({ contentType: 'text/plain', data: text });
  await env.SEND_EMAIL.send(new EmailMessage(BOT_EMAIL, OWNER_EMAIL, msg.asRaw()));
}

// Core query dependencies (fuzzy AI matcher + last-known-good cache) for the SMS
// route. Deliberately separate from the inline wiring in email() so this change
// leaves the InReach/email handler untouched; a later cleanup can DRY the two.
function makeCoreDeps(env: Env) {
  return {
    aliases,
    resolveFuzzy: async (text: string): Promise<string | null> => {
      const allowed = await claimAiCall(env.AI_BUDGET as unknown as KvLike, 'sms', DAILY_AI_CAPS.sms);
      if (!allowed) return null;
      return aiResolve(text, aliases, env.AI as unknown as AiBinding);
    },
    fetchCached: (source: GaugeSource, site: string) =>
      fetchCachedReading(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, source, site),
  };
}

function xmlResponse(body: string): Response {
  return new Response(body, { headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
}

// Twilio inbound-SMS webhook. Mirrors the email path's shape (validate sender →
// core query → deliver reply → fire-and-forget telemetry) but the reply rides
// back as TwiML on this same HTTP response instead of a separate send. The
// InReach/email paths are unaffected. See src/sms.ts for the primitives and the
// signature-validation rationale.
async function handleSmsWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // formData() throws on a malformed or non-form body. Parsing happens pre-auth (we
  // need the params to compute the signature), so a junk POST from any anonymous
  // caller would otherwise surface as a logged 500 on every hit — return a quiet
  // 400 instead.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response('bad request', { status: 400 });
  }
  const params: Record<string, string> = {};
  for (const [k, v] of form) {
    if (typeof v === 'string') params[k] = v;
  }

  // Reject spoofed callers before touching the gauge core — a public HTTP endpoint
  // has no gatekeeper the way the Email Routing catch-all does. The signature base
  // is request.url, so Twilio's configured webhook URL must byte-match what the
  // Worker sees (https://lateboof.com/api/sms, no trailing slash) or every request
  // 403s — fail-closed, but configure it exactly.
  const signature = request.headers.get('X-Twilio-Signature') ?? '';
  const valid = await validateTwilioSignature(request.url, params, env.TWILIO_AUTH_TOKEN ?? '', signature);
  if (!valid) return new Response('invalid signature', { status: 403 });

  const kv = env.AI_BUDGET as unknown as KvLike;

  // Authenticated, but not necessarily NEW: Twilio's signature covers the URL and
  // params, never a timestamp, so a captured request replays with a valid signature
  // indefinitely. MessageSid is unique per message — remembering it briefly collapses
  // a replayed burst into the single reply the paddler actually asked for. Empty
  // TwiML, so Twilio sends nothing and the duplicate costs no message.
  if (!(await claimMessageSid(kv, params.MessageSid ?? ''))) {
    console.warn('SMS replay ignored (MessageSid already seen):', params.MessageSid);
    return xmlResponse(twimlEmpty());
  }

  const { from, query } = parseSmsWebhook(params);

  // STOP/HELP/START are compliance keywords — stand aside and let Twilio's
  // toll-free Advanced Opt-Out own the reply, so we never double-send. Checked
  // BEFORE the throttle on purpose: a sender who has blown their cap must still be
  // able to opt out, and a compliance keyword we answer with silence costs nothing
  // anyway, so there is nothing to ration.
  if (isOptOutOrHelp(query)) return xmlResponse(twimlEmpty());

  // Per-sender throttle. This can only protect the OUTBOUND leg — Twilio bills the
  // inbound message before this Worker runs — but outbound is the pricier half on
  // toll-free and the only half an abuser amplifies. See src/smsThrottle.ts.
  // The owner's own number is exempt when SMS_OWNER_NUMBER is set, so a long
  // satellite test session can't lock out the person testing it.
  if (!env.SMS_OWNER_NUMBER || from !== env.SMS_OWNER_NUMBER) {
    const sender = await senderKey(from, env.TWILIO_AUTH_TOKEN ?? '');
    const throttle = await checkSmsThrottle(kv, sender);
    if (!throttle.allow) {
      console.warn('SMS sender throttled:', throttle.alert ?? 'already over cap');
      if (throttle.alert && (await claimOwnerAlert(kv, sender))) {
        ctx.waitUntil(
          notifyOwner(
            env,
            'LateBoof: SMS sender throttled',
            [
              `A number hit an SMS rate limit: ${throttle.alert}.`,
              '',
              `Number:  ${from}`,
              `Message: ${query.slice(0, 100)}`,
              '',
              'They got one notice and are silent for the rest of the window.',
              'At most one of these emails per number per 24h.',
              '',
              'If this is a real paddler, raise the cap in src/smsThrottle.ts.',
              'If it is abuse, block the number in the Twilio console — note that',
              'inbound is billed on receipt, so only Twilio can stop the cost.',
            ].join('\n'),
          ).catch((e) => console.error('notifyOwner failed:', e)),
        );
      }
      return xmlResponse(throttle.notice ? twimlMessage(throttle.notice) : twimlEmpty());
    }
  }

  // handleQuery is designed never to throw, but SMS is a metered channel — guard
  // it so an unexpected dep failure (e.g. the AI-budget KV) still returns a reply,
  // never a bare 500 that costs the paddler a message for nothing.
  let reply: string;
  try {
    reply = await handleQuery(query, makeCoreDeps(env));
  } catch (err) {
    console.error('handleQuery threw on SMS path:', err);
    reply = UNAVAILABLE;
  }

  // Fire-and-forget telemetry, mirroring the email path (never blocks the reply).
  // The SMS channel is success-only by nature: the TwiML reply rides this HTTP
  // response, so there's no separate delivery step that can fail from the Worker's
  // side the way the InReach web form or message.reply() can. Hence no
  // recordReplyFailure('sms') here — the status page's SMS row staying green is
  // expected, not a broken monitor.
  const resolved = reply !== NOT_FOUND && reply !== UNAVAILABLE;
  ctx.waitUntil(
    logQuery(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, query, resolved, 'sms').catch((err) =>
      console.error('logQuery failed:', err),
    ),
  );
  ctx.waitUntil(recordReplySuccess(kv, 'sms').catch((err) => console.error('recordReplySuccess failed:', err)));

  return xmlResponse(twimlMessage(reply));
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    const parsed = await new PostalMime().parse(message.raw);
    const body = parsed.text ?? '';
    const statusKv = env.AI_BUDGET as unknown as KvLike;
    // Set by onResolved before any reply attempt, so safeReplyByEmail can tell a
    // spam-shaped query from a real one when a reply fails -- see looksLikeSpam.
    let lastQuery = '';

    // Cache the InReach reply token for the nightly Garmin form check
    // (fire-and-forget — see src/canaryHelpers.ts).
    ctx.waitUntil(cacheInboundToken(statusKv, parseInbound(body).token));

    // The GitHub Action's nightly synthetic email replies normally but reports
    // to the 'canary' channel, keeping real paddler telemetry clean.
    const isCanary = isCanaryMessage(
      message.from,
      message.headers.get('Subject') ?? '',
      env.CANARY_FROM,
      env.CANARY_SECRET,
    );
    const emailChannel = isCanary ? ('canary' as const) : ('email' as const);

    const replyByEmail = async (text: string): Promise<void> => {
      const originalId = message.headers.get('Message-ID') ?? '';
      const originalSubject = message.headers.get('Subject') ?? 'river flow';
      const msg = createMimeMessage();
      const { inReplyTo, references } = buildReplyHeaders(originalId, message.headers.get('References') ?? '');
      if (inReplyTo) msg.setHeader('In-Reply-To', inReplyTo);
      if (references) msg.setHeader('References', references);
      msg.setSender({ name: 'Flow', addr: message.to });
      msg.setRecipient(message.from);
      msg.setSubject(originalSubject.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`);
      msg.addMessage({ contentType: 'text/plain', data: text });
      await message.reply(new EmailMessage(message.to, message.from, msg.asRaw()));
    };

    // Wrapped reply paths — catch errors, notify owner, then swallow so the worker
    // exits cleanly rather than logging a second unhandled-rejection.

    const safeReplyToInreach = async (token: string, text: string): Promise<void> => {
      try {
        await defaultReplyToInreach(token, text);
        await recordReplySuccess(statusKv, 'inreach');
      } catch (err) {
        console.error('replyToInreach failed:', err);
        const detail = err instanceof Error ? err.message : String(err);
        const failureCount = await recordReplyFailure(statusKv, 'inreach', detail);
        await notifyOwner(
          env,
          '[LateBoof] InReach reply failed',
          [
            'Could not deliver reply to paddler via the Garmin web form.',
            '',
            `From:       ${message.from}`,
            `Reply link: https://inreachlink.com/${token}`,
            '',
            'Reply text that was not delivered:',
            '---',
            text,
            '---',
            '',
            `Error: ${detail}`,
          ].join('\n'),
        ).catch((e) => console.error('notifyOwner failed:', e));
        if (shouldEscalate(failureCount)) {
          await notifyOwner(
            env,
            `[LateBoof] ALERT: ${failureCount} consecutive InReach reply failures`,
            [
              `The InReach reply path (Garmin's unofficial web form) has failed ${failureCount}`,
              'times in a row with no successful reply in between. This usually means Garmin',
              'changed the form and src/replyToInreach.ts needs an update — check',
              `${STATUS_ENDPOINT_PATH} or status.html for the latest state.`,
              '',
              `Most recent error: ${detail}`,
            ].join('\n'),
          ).catch((e) => console.error('escalation notifyOwner failed:', e));
        }
      }
    };

    // Unlike InReach (a curated, low-volume channel), flow@lateboof.com is a public
    // catch-all, so most email-reply failures are spam or other automated senders
    // that trip Cloudflare's DMARC check on reply() -- not real paddlers. The reply
    // is still attempted exactly the same either way (looksLikeSpam never skips
    // lookup or delivery); it's only used here to decide whether a failure is worth
    // recording at all. Spam-shaped failures are dropped before recordReplyFailure so
    // they never inflate consecutiveFailures/lastFailureAt on /api/status -- otherwise
    // the public catch-all's constant DMARC-rejected spam would make the email channel
    // look permanently broken even when every real paddler reply is landing fine. A
    // real-looking query that fails still records and pages, gated by the same
    // escalation threshold InReach uses.
    const safeReplyByEmail = async (text: string): Promise<void> => {
      try {
        await replyByEmail(text);
        await recordReplySuccess(statusKv, emailChannel);
      } catch (err) {
        console.error('replyByEmail failed:', err);
        if (looksLikeSpam(lastQuery)) return;
        const detail = err instanceof Error ? err.message : String(err);
        const failureCount = await recordReplyFailure(statusKv, emailChannel, detail);
        if (shouldEscalate(failureCount)) {
          await notifyOwner(
            env,
            `[LateBoof] ${failureCount} consecutive email reply failures`,
            [
              `The plain-email reply path has failed ${failureCount} times in a row.`,
              "This is often expected: flow@lateboof.com is a public catch-all, and",
              "spam/automated senders routinely fail Cloudflare's reply() DMARC check.",
              'Worth a look if this keeps climbing; check query_log in Supabase for',
              'what was actually being asked.',
              '',
              `Most recent sender: ${message.from}`,
              `Most recent error:  ${detail}`,
            ].join('\n'),
          ).catch((e) => console.error('notifyOwner failed:', e));
        }
      }
    };

    // AI fuzzy match, gated by the daily budget. Only invoked on a lookup miss.
    // Charged to the 'email' ingress — this covers InReach replies, plain email and
    // the canary alike, since the reply channel isn't decided until handleInbound
    // runs, well after the AI call has been spent.
    const resolveFuzzy = async (text: string): Promise<string | null> => {
      const allowed = await claimAiCall(env.AI_BUDGET as unknown as KvLike, 'email', DAILY_AI_CAPS.email);
      if (!allowed) return null;
      return aiResolve(text, aliases, env.AI as unknown as AiBinding);
    };

    ctx.waitUntil(
      handleInbound(body, {
        aliases,
        replyToInreach: safeReplyToInreach,
        replyByEmail: safeReplyByEmail,
        resolveFuzzy,
        fetchCached: (source, site) =>
          fetchCachedReading(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, source, site),
        onNoReplyPath: (query) => console.error('no reply path for query:', query),
        onResolved: (query, reply, channel) => {
          lastQuery = query;
          const resolved = reply !== NOT_FOUND && reply !== UNAVAILABLE;
          const logChannel = isCanary && channel === 'email' ? 'canary' : channel;
          ctx.waitUntil(
            logQuery(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, query, resolved, logChannel).catch(
              (err) => console.error('logQuery failed:', err),
            ),
          );
        },
      }).catch((err) => console.error('inbound handling failed:', err)),
    );
  },

  // Nightly self-check — ONE cron (wrangler.jsonc `triggers`) runs every check in
  // isolation via src/canaryRunner.ts. Checks are registered here as they ship:
  // gauge sweep + watchdog, then the Garmin form check. Findings/new errors send
  // at most one owner email per night; standing state lands in KV for /api/status.
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const kv = env.AI_BUDGET as unknown as KvLike;
    const checks: NightlyCheck[] = [
      buildSweepCheck({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, kv }),
      buildWatchdogCheck({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, kv }),
      buildTrendHealthCheck({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, kv }),
      buildGarminCheck({ kv }),
    ];
    ctx.waitUntil(
      runNightlyChecks(checks, {
        kv: env.AI_BUDGET as unknown as KvLike,
        notify: (subject, text) => notifyOwner(env, subject, text),
      }).catch((err) => console.error('nightly self-check failed:', err)),
    );
  },

  // HTTP routes, bound via `routes` in wrangler.jsonc separately from the Email
  // Routing catch-all above (that path is email; this one is HTTP):
  //   POST /api/sms    — Twilio inbound-SMS webhook (handleSmsWebhook).
  //   GET  /api/status — public read-only reply-health JSON for status.html
  //                      (src/statusTracking.ts).
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === SMS_ENDPOINT_PATH) {
      return handleSmsWebhook(request, env, ctx);
    }

    if (url.pathname === STATUS_ENDPOINT_PATH) {
      const summary = await getStatusSummary(env.AI_BUDGET as unknown as KvLike);
      return new Response(JSON.stringify(summary), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};
