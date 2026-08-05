/**
 * Per-sender send throttle for the SMS channel.
 *
 * What this can and cannot do, stated plainly because it shapes every choice
 * below: Twilio bills an INBOUND toll-free message the moment it receives it,
 * before this Worker is invoked. So a throttle can never stop the inbound leg —
 * it protects the OUTBOUND reply, which on toll-free is both the pricier leg and
 * the only one an abuser can amplify by texting more. The real ceiling on abuse
 * is the account balance (stay prepaid), not this file.
 *
 * Two windows, both per sender:
 *   HOURLY_CAP  — a burst limit. A paddler checking a few runs before a trip is
 *                 nowhere near it; a script is over it in seconds.
 *   MONTHLY_CAP — a sustained-abuse stop.
 *
 * Crossing either cap sends ONE notice and then goes silent for the rest of the
 * window. The notice matters: silence is indistinguishable from a broken bot, and
 * this is a tool people rely on from places where they cannot check a website.
 * Bounded at one notice per window per sender, it costs at most a few messages a
 * day even under a flood.
 *
 * Senders are stored HASHED (see senderKey) — phone numbers are PII, and the same
 * reasoning that gave sms_optin no anon SELECT policy (migration 012) applies to
 * a keystore. The owner alert carries the real number, since acting on it means
 * blocking it in Twilio.
 */

import type { KvLike } from './budget.js';

/** Burst limit per sender per clock hour. */
export const HOURLY_CAP = 10;

/**
 * Sustained limit per sender per calendar month.
 *
 * Read this as "the most one phone number can cost me", NOT as a spend ceiling:
 * the cap is per sender, so ten senders can each reach it. 300 messages answered
 * is roughly $5 of Twilio traffic from ONE number. Aggregate spend is bounded by
 * the account balance (stay prepaid) and by a usage trigger — never by this.
 *
 * 300 also leaves room for the heaviest plausible real user: an outfitter checking
 * a few runs twice a day through a season clears 100 without doing anything wrong,
 * and locking out a genuine paddler for the rest of a month is a worse outcome than
 * paying for their messages.
 */
export const MONTHLY_CAP = 300;

const HOUR_TTL = 60 * 90; // 1.5h — outlives the window it counts, then vanishes
const MONTH_TTL = 60 * 60 * 24 * 35;
const ALERT_TTL = 60 * 60 * 24; // at most one owner email per sender per day

// Both stay under the 160-char reply contract (src/formatReply.ts) so a notice is
// a single billed segment, same as a real answer.
const HOURLY_NOTICE = `LateBoof: too many texts this hour (limit ${HOURLY_CAP}). Try again later — every gauge is also at lateboof.com/gauges`;
const MONTHLY_NOTICE = `LateBoof: monthly limit reached (${MONTHLY_CAP} texts). Resets on the 1st — every gauge is also at lateboof.com/gauges`;

export interface ThrottleDecision {
  /** May the caller run the query and reply normally? */
  allow: boolean;
  /** When set, reply with exactly this instead of a gauge reading. */
  notice?: string;
  /** When set, a one-line reason worth telling the owner about. */
  alert?: string;
}

/**
 * Stable, non-reversible id for a phone number, used as the KV key.
 *
 * HMAC rather than a bare hash, keyed with the Twilio auth token: the US phone
 * number space is small enough (~10^10) that an unsalted SHA-256 of a number is
 * trivially brute-forced, which would make "we hashed it" a comfortable fiction.
 * Keying with a secret the attacker would need to already hold makes the stored
 * ids genuinely opaque.
 *
 * Consequence to know about: rotating TWILIO_AUTH_TOKEN re-keys every counter, so
 * all senders start fresh. That is rare and harmless — and a rotation is usually
 * exactly when you want a clean slate anyway.
 */
export async function senderKey(from: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(from));
  // 64 bits of the digest — ample keyspace for a roster of paddlers, and it keeps
  // KV keys short.
  return [...new Uint8Array(mac).slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toCount(raw: string | null): number {
  const n = Number(raw ?? '0');
  return Number.isFinite(n) ? n : 0;
}

/**
 * Count this message against the sender's windows and decide what to do with it.
 *
 * Fails OPEN on a KV error, matching claimMessageSid and opposite to claimAiCall:
 * an unreadable counter must never cost a paddler the one message they sent from
 * a canyon. The downside of guessing wrong here is a few cents.
 *
 * Two deliberate imprecisions, both acceptable because the job is bounding cost,
 * not enforcing a contract:
 *
 *   - FIXED windows, not sliding. The hour key is a UTC clock hour, so a sender
 *     can spend a full allowance at 14:59 and another at 15:01. Bounding the
 *     sustained rate is what matters; a doubled two-minute burst costs cents. A
 *     sliding window would need a read-modify-write of a timestamp list per
 *     message — more KV traffic than the abuse it prevents. Same for the month
 *     boundary, which lands at UTC midnight on the 1st (5pm PT the day before);
 *     the notice says "resets on the 1st" without claiming a timezone.
 *
 *   - NOT atomic. KV has no increment primitive, so get-then-put means two
 *     simultaneous messages can read the same count and both write n+1, leaking
 *     one. Same caveat as claimMessageSid. If puts fail persistently the count
 *     stops advancing and every message re-reads as the crossing one, so senders
 *     get a notice instead of silence — still cheaper than a full gauge reply,
 *     which is what they would have gotten with no throttle at all.
 */
export async function checkSmsThrottle(
  kv: KvLike,
  sender: string,
  now: Date = new Date(),
): Promise<ThrottleDecision> {
  const iso = now.toISOString();
  const hourKey = `sms:hr:${sender}:${iso.slice(0, 13)}`; // ...:YYYY-MM-DDTHH
  const monthKey = `sms:mo:${sender}:${iso.slice(0, 7)}`; // ...:YYYY-MM

  let hour: number;
  let month: number;
  try {
    const [h, m] = await Promise.all([kv.get(hourKey), kv.get(monthKey)]);
    hour = toCount(h);
    month = toCount(m);
  } catch {
    return { allow: true }; // store unreadable → answer anyway
  }

  const nextHour = hour + 1;
  const nextMonth = month + 1;

  // Count every message, including ones we refuse to answer. The counters should
  // describe what the sender actually did, so a persistent flood stays throttled
  // instead of recovering the moment we stop replying to it.
  try {
    await Promise.all([
      kv.put(hourKey, String(nextHour), { expirationTtl: HOUR_TTL }),
      kv.put(monthKey, String(nextMonth), { expirationTtl: MONTH_TTL }),
    ]);
  } catch {
    // tolerate: a lost increment slightly undercounts, it never over-blocks.
  }

  // Month is checked first so its notice wins — "resets on the 1st" is the more
  // useful thing to hear when both caps are blown.
  if (nextMonth > MONTHLY_CAP) {
    return nextMonth === MONTHLY_CAP + 1
      ? { allow: false, notice: MONTHLY_NOTICE, alert: `monthly cap reached (${MONTHLY_CAP} texts)` }
      : { allow: false };
  }
  if (nextHour > HOURLY_CAP) {
    return nextHour === HOURLY_CAP + 1
      ? { allow: false, notice: HOURLY_NOTICE, alert: `hourly cap exceeded (${HOURLY_CAP}/hr)` }
      : { allow: false };
  }
  return { allow: true };
}

/**
 * Rate-limit the owner alert itself: true at most once per sender per 24h.
 *
 * Without this the feature is an amplifier — every throttled message would send
 * an email, so a flood aimed at the toll-free number becomes a flood aimed at the
 * owner's inbox, delivered by us. Fails CLOSED (no email) on a KV error: a missed
 * notification is recoverable, a mail flood during an incident is not.
 */
export async function claimOwnerAlert(kv: KvLike, sender: string): Promise<boolean> {
  const key = `sms:alerted:${sender}`;
  try {
    if (await kv.get(key)) return false;
    await kv.put(key, '1', { expirationTtl: ALERT_TTL });
  } catch {
    return false;
  }
  return true;
}
