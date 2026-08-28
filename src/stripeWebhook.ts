/**
 * Stripe webhook → donation row: the pure half of web/functions/api/stripe-webhook.ts.
 *
 * No I/O in here. Signature verification takes the raw body and the header,
 * event mapping takes already-parsed JSON, and the Pages Function does the
 * fetching — same split as replayLogic.ts / replay.ts, so every branch that
 * decides whether a name lands on lateboof.com/support is unit-tested.
 *
 * Stripe's scheme (https://docs.stripe.com/webhooks#verify-manually):
 *   Stripe-Signature: t=<unix seconds>,v1=<hex hmac>[,v1=<hex hmac>]
 *   signed payload  = `${t}.${raw body}`
 *   hmac            = HMAC-SHA256(endpoint secret, signed payload)
 * Multiple v1 values appear while a secret is being rotated; any match passes.
 */

export const STRIPE_SIGNATURE_TOLERANCE_SEC = 300;
export const DISPLAY_NAME_MAX = 40;
/** Key of the optional "name for the supporters list" custom field on the Payment Link. */
export const SUPPORTER_NAME_FIELD = 'supporter_name';

export interface StripeSignature {
  timestamp: number;
  signatures: string[];
}

export function parseStripeSignature(header: string | null | undefined): StripeSignature | null {
  if (!header) return null;
  let timestamp = NaN;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') timestamp = Number(value);
    else if (key === 'v1' && /^[0-9a-f]{64}$/i.test(value)) signatures.push(value.toLowerCase());
  }
  if (!Number.isFinite(timestamp) || signatures.length === 0) return null;
  return { timestamp, signatures };
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time compare so a forged signature can't be brute-forced byte by byte. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** What Stripe would send for this body — used by the tests and by local smoke tests. */
export async function signStripePayload(secret: string, timestamp: number, rawBody: string): Promise<string> {
  return `t=${timestamp},v1=${await hmacSha256Hex(secret, `${timestamp}.${rawBody}`)}`;
}

export async function verifyStripeSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  toleranceSec: number = STRIPE_SIGNATURE_TOLERANCE_SEC,
): Promise<boolean> {
  const parsed = parseStripeSignature(header);
  if (!parsed) return false;
  // A captured request stays valid forever without this; the window is the whole replay defense.
  if (Math.abs(nowSec - parsed.timestamp) > toleranceSec) return false;
  const expected = await hmacSha256Hex(secret, `${parsed.timestamp}.${rawBody}`);
  return parsed.signatures.some((s) => timingSafeEqualHex(s, expected));
}

/**
 * The name a supporter typed at checkout, made safe for a public page: whitespace
 * collapsed, control characters gone, capped, and anything that looks like a URL,
 * a domain, or an email dropped entirely — a $1 donation must not buy a link on
 * lateboof.com. Null means "show nothing", never a placeholder.
 */
export function cleanDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  if (/https?:|www\.|@|\.[a-z]{2,}(\/|\b)/i.test(s)) return null;
  return s.length > DISPLAY_NAME_MAX ? s.slice(0, DISPLAY_NAME_MAX).trimEnd() : s;
}

export interface DonationRow {
  stripe_session_id: string;
  tier: 'paddler';
  amount_cents: number;
  currency: string;
  display_name: string | null;
  email: string | null;
  season: string;
}

interface StripeCustomField {
  key?: unknown;
  text?: { value?: unknown };
}

interface StripeSessionLike {
  id?: unknown;
  payment_status?: unknown;
  amount_total?: unknown;
  currency?: unknown;
  /** Present when Adaptive Pricing showed the donor a local currency; carries the price-currency (USD) figures. */
  currency_conversion?: { amount_total?: unknown; source_currency?: unknown } | null;
  custom_fields?: unknown;
  customer_details?: { email?: unknown; name?: unknown } | null;
}

function isCents(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0;
}

interface StripeEventLike {
  type?: unknown;
  data?: { object?: StripeSessionLike | null } | null;
}

/**
 * Map a verified Stripe event to the row the webhook inserts, or null when the
 * event is not a paid Checkout Session (Stripe still expects a 2xx for those).
 *
 * `checkout.session.completed` arrives for every finished checkout, including
 * ones whose bank-debit payment is still pending — those come back later as
 * `checkout.session.async_payment_succeeded`, so both are accepted and the
 * `paid` status is what actually gates the insert. The session id is unique in
 * the table, so a retried or duplicated event is a no-op.
 *
 * The display name comes only from the optional custom field. A blank field is
 * a choice — the customer's billing name is never used as a fallback.
 *
 * Money is recorded in the price currency (USD), not what the donor saw:
 * Payment Links localize prices by default (Adaptive Pricing), so a Canadian
 * donor's session carries `currency: "cad"` and a CAD `amount_total`, with the
 * USD figures under `currency_conversion`. Summing raw `amount_total` across
 * currencies would inflate the goal bar; the USD figure is what it tracks.
 */
export function donationFromEvent(event: unknown, season: string): DonationRow | null {
  const e = event as StripeEventLike | null;
  if (!e || typeof e !== 'object') return null;
  if (e.type !== 'checkout.session.completed' && e.type !== 'checkout.session.async_payment_succeeded') {
    return null;
  }
  const s = e.data?.object;
  if (!s || typeof s !== 'object' || typeof s.id !== 'string') return null;
  if (s.payment_status !== 'paid') return null;

  const conv = s.currency_conversion;
  const converted = conv && isCents(conv.amount_total) && typeof conv.source_currency === 'string';
  const amount_cents = converted ? (conv.amount_total as number) : s.amount_total;
  const currency = converted ? (conv.source_currency as string) : typeof s.currency === 'string' ? s.currency : 'usd';
  if (!isCents(amount_cents)) return null;

  const fields = Array.isArray(s.custom_fields) ? (s.custom_fields as StripeCustomField[]) : [];
  const nameField = fields.find((f) => f && f.key === SUPPORTER_NAME_FIELD);
  const email = typeof s.customer_details?.email === 'string' ? s.customer_details.email : null;

  return {
    stripe_session_id: s.id,
    tier: 'paddler',
    amount_cents,
    currency: currency.toLowerCase(),
    display_name: cleanDisplayName(nameField?.text?.value),
    email,
    season,
  };
}
