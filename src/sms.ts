/**
 * SMS (Twilio) adapter primitives — the v2 channel that lights up iPhone-satellite
 * texting and doubles as the fallback if Garmin ever changes the InReach reply form.
 *
 * Everything here is pure and testable with no Worker runtime and no network: the
 * Worker's fetch() handler (src/worker.ts) decodes the inbound webhook form, calls
 * these, and hands the query to the same channel-agnostic core the email/InReach
 * paths use (src/handleQuery.ts). The InReach path is untouched — SMS is additive.
 *
 *   Twilio ──POST form──▶ fetch() /api/sms
 *                            │ validateTwilioSignature  (reject spoofed callers)
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
 * Twilio's inbound-SMS webhook params -> the query the core understands. Far
 * simpler than parseInbound (email): the message body *is* the query — no Garmin
 * footer to strip, no reply token (the reply goes back on the HTTP response).
 */
export function parseSmsWebhook(params: Record<string, string>): {
  from: string;
  body: string;
  query: string;
} {
  const from = params.From ?? '';
  const body = params.Body ?? '';
  return { from, body, query: body.trim() };
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
