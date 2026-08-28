/**
 * SMS (Twilio) adapter primitives — the v2 channel that lights up iPhone-satellite
 * texting and doubles as the fallback if Garmin ever changes the InReach reply form.
 *
 * Everything here runs with no Worker runtime and no network — pure functions, or
 * (claimMessageSid) a KV dependency injected the way src/budget.ts does it, so the
 * whole module is unit-testable with a fake store. The Worker's fetch() handler
 * (src/worker.ts) decodes the inbound webhook form, calls these, and hands the query
 * to the same channel-agnostic core the email/InReach paths use
 * (src/handleQuery.ts). The InReach path is untouched — SMS is additive.
 *
 *   Twilio ──POST form──▶ fetch() /api/sms
 *                            │ validateTwilioSignature  (reject spoofed callers)
 *                            │ claimMessageSid          (collapse replays)
 *                            │ parseSmsWebhook          (From + Body -> query)
 *                            │ isOptOutOrHelp?          (STOP/HELP -> stand aside)
 *                            ▼
 *                       handleQuery(query) ─▶ reply text
 *                            │ twimlMessage(reply)
 *                            ▼
 *                   200 text/xml  ─▶ Twilio ─▶ device
 *
 * Reply mechanism = TwiML (the reply rides the webhook's own HTTP response), not
 * the Twilio REST API. It's synchronous, matches Flow's "one message out, one
 * message back" contract, and needs NO Twilio send-credentials — the auth token
 * exists here only to *validate inbound* requests. (Outbound-initiated sends, i.e.
 * flow alerts, are a later feature that would need the REST API + Account SID.)
 */

import type { KvLike } from './budget.js';

/**
 * Verify an inbound webhook actually came from Twilio.
 *
 * Unlike the email() handler (only Cloudflare Email Routing can ever invoke it), a
 * public HTTP endpoint has no gatekeeper — without this, anyone who finds the URL
 * could POST spoofed "inbound texts" and make the bot burn Twilio balance. Twilio
 * signs every request; we recompute the signature and compare.
 *
 * Algorithm (Twilio's, for a POST application/x-www-form-urlencoded webhook):
 *   1. Start with the exact request URL Twilio called (param-free by design here).
 *   2. Sort the POST params by key; append each key immediately followed by its
 *      value (no separators).
 *   3. HMAC-SHA1 that string with the account auth token, base64-encode.
 *   4. Constant-time compare to the X-Twilio-Signature header.
 *
 * Fails closed: an empty token or missing signature returns false, never true.
 */
export async function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  authToken: string,
  providedSignature: string,
): Promise<boolean> {
  if (!authToken || !providedSignature) return false;

  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + (params[key] ?? ''), url);

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  return timingSafeEqual(expected, providedSignature);
}

/** Length-checked constant-time string compare, so a wrong signature can't be
 *  probed byte-by-byte via response timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * How long a MessageSid is remembered for replay detection. Twilio signs the URL
 * and the params but NOT a timestamp, so a captured signed request stays valid
 * forever and the signature alone cannot tell a replay from a first delivery. The
 * window is therefore the whole defense, and it is a trade: long enough to cover a
 * realistic replay burst, short enough that KV never accumulates. Fifteen minutes
 * also comfortably covers Twilio's own webhook retry behavior.
 */
const REPLAY_TTL_SECONDS = 15 * 60;

/**
 * Claim an inbound message by its Twilio MessageSid. Returns true the first time a
 * sid is seen (caller should process it) and false on a repeat (caller should reply
 * with nothing).
 *
 * Fails OPEN — the exact opposite of claimAiCall in src/budget.ts, and deliberately
 * so. That counter guards money, so an unreadable store means don't spend. This one
 * guards against a duplicate reply, so an unreadable store must not cost a paddler
 * the one message they sent from a canyon. Cheap-to-lose vs expensive-to-lose points
 * the two failure postures in opposite directions.
 *
 * Best-effort by construction: KV is eventually consistent and get-then-put is not
 * atomic, so two truly simultaneous replays can both slip through. That is fine —
 * this collapses a replayed burst, it is not a distributed lock.
 */
export async function claimMessageSid(kv: KvLike, sid: string): Promise<boolean> {
  // No sid to dedup on. Not a real vector: a replay is a captured *legitimate*
  // request, which always carries one, and forging a sid-less request needs the
  // auth token — at which point dedup is moot. Process it.
  if (!sid) return true;

  const key = `sms:sid:${sid}`;
  try {
    if (await kv.get(key)) return false;
  } catch {
    return true; // store unreadable → reply anyway (see docstring)
  }

  try {
    await kv.put(key, '1', { expirationTtl: REPLAY_TTL_SECONDS });
  } catch {
    // tolerate: worst case a genuine replay of this one message gets a second reply.
  }
  return true;
}

/**
 * Twilio's inbound-SMS webhook params -> the query the core understands. Simpler
 * than parseInbound (email): no reply token, the reply rides the HTTP response.
 * The one thing to strip is Garmin's relay footer, below — since 2026-08-28 the
 * toll-free number is an inReach contact too, not just a phone one.
 */
/**
 * Garmin's inReach→SMS relay appends a location/reply link (and, depending on the
 * plan, a line of boilerplate) to every text a device sends. The paddler never typed
 * any of it, so it must not reach the resolver or query_log. Any other URL is
 * dropped for the same reason — no supported query contains one.
 */
const INREACH_LINK = /https?:\/\/(?:www\.)?inreachlink\.com\/\S*/i;
const ANY_URL = /https?:\/\/\S+/gi;
const RELAY_BOILERPLATE = /^\s*(view (the )?location|do not reply|this message was sent|sent (to you )?(from|using)).*$/gim;

export function parseSmsWebhook(params: Record<string, string>): {
  from: string;
  body: string;
  query: string;
  /** True when the text came through Garmin's inReach→SMS relay (the body carried an inreachlink). */
  inreach: boolean;
} {
  const from = params.From ?? '';
  const body = params.Body ?? '';
  const inreach = INREACH_LINK.test(body);
  const query = body.replace(RELAY_BOILERPLATE, ' ').replace(ANY_URL, ' ').replace(/\s+/g, ' ').trim();
  return { from, body, query, inreach };
}

// Carrier/Twilio-reserved keywords. When the whole message is one of these, it's
// an opt-out/opt-in/help command, not a gauge query — we stand aside and let
// Twilio's platform-level Advanced Opt-Out own the compliance reply (see
// isOptOutOrHelp).
const RESERVED_KEYWORDS = new Set([
  'STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', // opt-out
  'START', 'YES', 'UNSTOP', // opt-in
  'HELP', 'INFO', // help
]);

/**
 * True when the entire message is a reserved STOP/HELP/START keyword. We return an
 * empty TwiML for these rather than replying ourselves, so Twilio's toll-free
 * Advanced Opt-Out handling is the single source of truth for consent — no risk of
 * a conflicting or duplicate compliance message.
 */
export function isOptOutOrHelp(body: string): boolean {
  return RESERVED_KEYWORDS.has(body.trim().toUpperCase());
}

/** Escape the five XML metacharacters so a gauge name containing '&' (or stray
 *  angle brackets) can't break the TwiML document. */
export function xmlEscape(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c,
  );
}

/** TwiML that texts one message back on the webhook response. */
export function twimlMessage(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(text)}</Message></Response>`;
}

/** TwiML that replies with nothing (used for STOP/HELP — Twilio handles those). */
export function twimlEmpty(): string {
  return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
}
