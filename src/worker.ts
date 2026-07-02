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
import { claimAiCall, type KvLike } from './budget.js';
import { fetchCachedReading } from './supabaseCache.js';
import { logQuery } from './queryLog.js';
import { looksLikeSpam } from './spamFilter.js';
import { NOT_FOUND, UNAVAILABLE } from './handleQuery.js';
import { buildReplyHeaders } from './emailReply.js';
import {
  recordReplySuccess,
  recordReplyFailure,
  shouldEscalate,
  getStatusSummary,
} from './statusTracking.js';
import aliasesJson from './aliases.json' with { type: 'json' };
import type { GaugeAlias } from './lookupGauge.js';

const aliases = aliasesJson as Record<string, GaugeAlias>;

// ~2.3 neurons/call → 1,000/day ≈ 2,300 neurons, well under the free 10k/day tier.
const MAX_AI_CALLS_PER_DAY = 1000;

const OWNER_EMAIL = 'okurthdev@gmail.com';
// Fixed sender for owner alerts — deliberately not message.to, since the catch-all
// means that could be any address @lateboof.com a paddler happens to type.
const BOT_EMAIL = 'flow@lateboof.com';
// Reuses the AI-call-budget KV namespace under a separate "status:" key prefix
// (see src/statusTracking.ts) rather than provisioning a second namespace for what
// is, from the Worker's side, just more small counters.
const STATUS_ENDPOINT_PATH = '/api/status';

interface Env {
  AI: Ai;
  AI_BUDGET: KVNamespace;
  SEND_EMAIL: SendEmail;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
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

export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    const parsed = await new PostalMime().parse(message.raw);
    const body = parsed.text ?? '';
    const statusKv = env.AI_BUDGET as unknown as KvLike;
    // Set by onResolved before any reply attempt, so safeReplyByEmail can tell a
    // spam-shaped query from a real one when a reply fails -- see looksLikeSpam.
    let lastQuery = '';

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
    // paging the owner about. Spam-shaped failures are still recorded (so /api/status
    // and query_log stay complete) but never notify. A real-looking query that fails
    // still pages, gated by the same escalation threshold InReach uses.
    const safeReplyByEmail = async (text: string): Promise<void> => {
      try {
        await replyByEmail(text);
        await recordReplySuccess(statusKv, 'email');
      } catch (err) {
        console.error('replyByEmail failed:', err);
        const detail = err instanceof Error ? err.message : String(err);
        const failureCount = await recordReplyFailure(statusKv, 'email', detail);
        if (looksLikeSpam(lastQuery)) return;
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
    const resolveFuzzy = async (text: string): Promise<string | null> => {
      const allowed = await claimAiCall(env.AI_BUDGET as unknown as KvLike, MAX_AI_CALLS_PER_DAY);
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
          ctx.waitUntil(
            logQuery(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, query, resolved, channel).catch(
              (err) => console.error('logQuery failed:', err),
            ),
          );
        },
      }).catch((err) => console.error('inbound handling failed:', err)),
    );
  },

  // Public, read-only reply-health JSON for status.html — see src/statusTracking.ts.
  // Bound to lateboof.com/api/status via the `routes` entry in wrangler.jsonc,
  // separately from the Email Routing catch-all above.
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== STATUS_ENDPOINT_PATH) {
      return new Response('Not found', { status: 404 });
    }
    const summary = await getStatusSummary(env.AI_BUDGET as unknown as KvLike);
    return new Response(JSON.stringify(summary), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
    });
  },
};
