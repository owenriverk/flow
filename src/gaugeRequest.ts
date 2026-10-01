/**
 * "Request a gauge" — the bar under the homepage table (web/request.js) POSTs a
 * run or gauge name here and the owner gets one email per request.
 *
 * What shapes this file: it is a public, unauthenticated endpoint whose only
 * side effect is mail to the owner. That makes it an amplifier — a script
 * pointed at it becomes a flood in the owner's inbox, delivered by us — so the
 * caps below are the feature's real boundary, the same reasoning as
 * claimOwnerAlert in src/smsThrottle.ts:
 *
 *   DAILY_CAP             — the most email this endpoint can send in a UTC day,
 *                           no matter how many visitors are asking.
 *   PER_VISITOR_DAILY_CAP — keeps one visitor from spending the whole day's
 *                           allowance and locking out everyone else.
 *
 * Both fail CLOSED on a KV error: the visitor is told to try again, which is
 * recoverable; a mail flood during an incident is not.
 *
 * JSON only, on purpose. A cross-origin page cannot send application/json
 * without a CORS preflight, and this endpoint never answers one, so the form on
 * lateboof.com is the only browser that can reach it. The Origin check is a
 * second, cheaper filter for the same thing.
 */

import type { KvLike } from './budget.js';
import { lookupGauge, type GaugeAlias } from './lookupGauge.js';

export const REQUEST_MIN = 3;
export const REQUEST_MAX = 200;
export const DAILY_CAP = 40;
export const PER_VISITOR_DAILY_CAP = 5;

const DAY_TTL = 60 * 60 * 36; // outlives the UTC day it counts, then vanishes
const ALLOWED_ORIGINS = new Set(['https://lateboof.com', 'https://www.lateboof.com']);

export interface GaugeRequestDeps {
  kv: KvLike;
  aliases: Record<string, GaugeAlias>;
  /** Sends the owner email. A throw becomes a 502 so the visitor can retry. */
  notify: (subject: string, text: string) => Promise<void>;
  /** Opaque, non-reversible id for a visitor IP (never store the address). */
  visitorKey: (ip: string) => Promise<string>;
  now?: () => Date;
}

export type ParsedRequest = { ok: true; request: string; bot: boolean } | { ok: false; message: string };

/**
 * Validate the posted body. Whitespace (including newlines) collapses to single
 * spaces and control characters are dropped: the text lands in an email subject,
 * and a request is a name, never a paragraph.
 */
export function parseGaugeRequest(body: unknown): ParsedRequest {
  if (typeof body !== 'object' || body === null) return { ok: false, message: 'Could not read that — try again?' };
  const fields = body as Record<string, unknown>;

  // Honeypot: the form's `website` field is hidden from people, so only a bot
  // fills it. The caller answers these with a quiet success and sends nothing.
  const bot = typeof fields.website === 'string' && fields.website.trim() !== '';

  const request = (typeof fields.request === 'string' ? fields.request : '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (request.length < REQUEST_MIN) return { ok: false, message: 'Name the run or gauge you want added.' };
  if (request.length > REQUEST_MAX) return { ok: false, message: `Keep it under ${REQUEST_MAX} characters.` };
  return { ok: true, request, bot };
}

/**
 * One line telling the owner whether the bot already answers this text — half of
 * all "requests" are for a run that is on the list under another name.
 */
export function rosterNote(request: string, aliases: Record<string, GaugeAlias>): string {
  const ref = lookupGauge(request, aliases);
  if (!ref) return 'Not on the roster — the bot answers this with "not found" today.';
  if ('name' in ref) return `Already resolves to: ${ref.name} (${ref.source} ${ref.site}). They may want a different section or gauge.`;
  return `That is a raw ${ref.source.toUpperCase()} gauge ID (${ref.site}) — the bot already answers it, but it has no run name.`;
}

function toCount(raw: string | null): number {
  const n = Number(raw ?? '0');
  return Number.isFinite(n) ? n : 0;
}

type CapDecision = { allow: true; today: number } | { allow: false; message: string; status: number };

/**
 * Count this request against today's windows. Not atomic (KV has no increment),
 * same caveat as checkSmsThrottle: two simultaneous requests can leak one. The
 * job is bounding the inbox, not enforcing a contract.
 */
async function claimRequestSlot(kv: KvLike, visitor: string, now: Date): Promise<CapDecision> {
  const day = now.toISOString().slice(0, 10);
  const dayKey = `req:day:${day}`;
  const visitorKey = `req:v:${visitor}:${day}`;
  try {
    const [d, v] = await Promise.all([kv.get(dayKey), kv.get(visitorKey)]);
    const total = toCount(d);
    const mine = toCount(v);
    if (mine >= PER_VISITOR_DAILY_CAP) {
      return { allow: false, status: 429, message: 'That is plenty of requests for one day — try again tomorrow.' };
    }
    if (total >= DAILY_CAP) {
      return { allow: false, status: 429, message: 'The request line is full for today — try again tomorrow.' };
    }
    await Promise.all([
      kv.put(dayKey, String(total + 1), { expirationTtl: DAY_TTL }),
      kv.put(visitorKey, String(mine + 1), { expirationTtl: DAY_TTL }),
    ]);
    return { allow: true, today: total + 1 };
  } catch {
    return { allow: false, status: 503, message: 'Requests are briefly unavailable — try again in a minute.' };
  }
}

function json(status: number, ok: boolean, message: string): Response {
  return new Response(JSON.stringify({ ok, message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const SENT = 'Sent — it goes straight to the person who curates the list.';

export async function handleGaugeRequest(request: Request, deps: GaugeRequestDeps): Promise<Response> {
  if (request.method !== 'POST') return json(405, false, 'Method not allowed.');

  const origin = request.headers.get('Origin');
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return json(403, false, 'Requests come from lateboof.com.');
  if (!(request.headers.get('Content-Type') ?? '').includes('application/json')) {
    return json(415, false, 'Could not read that — try again?');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, false, 'Could not read that — try again?');
  }

  const parsed = parseGaugeRequest(body);
  if (!parsed.ok) return json(400, false, parsed.message);
  // A bot gets the same answer a person does, so it learns nothing — and no
  // email, no counter: it must not be able to spend a real visitor's allowance.
  if (parsed.bot) return json(200, true, SENT);

  const now = (deps.now ?? (() => new Date()))();
  let visitor: string;
  try {
    visitor = await deps.visitorKey(request.headers.get('CF-Connecting-IP') ?? 'unknown');
  } catch {
    return json(503, false, 'Requests are briefly unavailable — try again in a minute.');
  }

  const slot = await claimRequestSlot(deps.kv, visitor, now);
  if (!slot.allow) return json(slot.status, false, slot.message);

  const subject = `LateBoof request: ${parsed.request.slice(0, 70)}`;
  const text = [
    'Someone asked for a run or gauge on lateboof.com:',
    '',
    `  ${parsed.request}`,
    '',
    rosterNote(parsed.request, deps.aliases),
    '',
    `Sent:           ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    `Requests today: ${slot.today} of ${DAILY_CAP}`,
    '',
    'The form collects no contact details, so there is nobody to reply to.',
  ].join('\n');

  try {
    await deps.notify(subject, text);
  } catch (err) {
    console.error('gauge request email failed:', err);
    return json(502, false, 'Could not send that — try again in a minute.');
  }
  return json(200, true, SENT);
}
