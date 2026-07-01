/**
 * Tracks reply-delivery health per channel (InReach web-form POST, plain email) in
 * KV. The Garmin web form (src/replyToInreach.ts) is an unofficial, undocumented
 * endpoint with no platform-level reliability guarantee — if it silently breaks, the
 * only signal today is a per-failure email, which only fires when a real paddler
 * happens to hit it. This adds two things: an escalation alert once failures look
 * systemic rather than one-off, and enough state for a real status page instead of a
 * hand-typed claim.
 *
 * Every function here fails open: a KV hiccup must never block a reply attempt or
 * break the status endpoint. Worst case the status page is briefly stale, or one
 * escalation email is missed (the per-failure notifyOwner alert fires independently
 * and is unaffected by anything in this file).
 */

import type { KvLike } from './budget.js';

export type ReplyChannel = 'inreach' | 'email';

interface ChannelStatus {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureDetail: string | null;
  consecutiveFailures: number;
}

export interface StatusSummary {
  inreach: ChannelStatus;
  email: ChannelStatus;
}

function keysFor(channel: ReplyChannel) {
  return {
    lastSuccess: `status:${channel}:last_success_at`,
    lastFailure: `status:${channel}:last_failure_at`,
    lastFailureDetail: `status:${channel}:last_failure_detail`,
    consecutiveFailures: `status:${channel}:consecutive_failures`,
  };
}

export async function recordReplySuccess(
  kv: KvLike,
  channel: ReplyChannel,
  now: Date = new Date(),
): Promise<void> {
  const k = keysFor(channel);
  try {
    await kv.put(k.lastSuccess, now.toISOString());
    await kv.put(k.consecutiveFailures, '0');
  } catch {
    // best-effort — a KV write failure must never affect a reply that already succeeded
  }
}

/**
 * Records a failure and returns the new consecutive-failure count so the caller can
 * decide whether to escalate. Returns 1 (rather than throwing) if KV itself is
 * unreachable, since "assume the worst, maybe escalate anyway" is the safer failure
 * mode for a monitoring path.
 */
export async function recordReplyFailure(
  kv: KvLike,
  channel: ReplyChannel,
  detail: string,
  now: Date = new Date(),
): Promise<number> {
  const k = keysFor(channel);
  try {
    const prev = Number((await kv.get(k.consecutiveFailures)) ?? '0');
    const count = (Number.isFinite(prev) ? prev : 0) + 1;
    await kv.put(k.lastFailure, now.toISOString());
    await kv.put(k.lastFailureDetail, detail.slice(0, 500));
    await kv.put(k.consecutiveFailures, String(count));
    return count;
  } catch {
    return 1;
  }
}

/** Escalate on the 3rd consecutive failure, then every 5th after that (3, 8, 13, ...) —
 *  enough to catch a systemic break fast without paging the owner on one flaky request. */
export function shouldEscalate(consecutiveFailures: number): boolean {
  return consecutiveFailures === 3 || (consecutiveFailures > 3 && (consecutiveFailures - 3) % 5 === 0);
}

async function readChannelStatus(kv: KvLike, channel: ReplyChannel): Promise<ChannelStatus> {
  const k = keysFor(channel);
  const safeGet = (key: string) => kv.get(key).catch(() => null);
  const [lastSuccessAt, lastFailureAt, lastFailureDetail, rawCount] = await Promise.all([
    safeGet(k.lastSuccess),
    safeGet(k.lastFailure),
    safeGet(k.lastFailureDetail),
    safeGet(k.consecutiveFailures),
  ]);
  const consecutiveFailures = Number(rawCount ?? '0');
  return {
    lastSuccessAt,
    lastFailureAt,
    lastFailureDetail,
    consecutiveFailures: Number.isFinite(consecutiveFailures) ? consecutiveFailures : 0,
  };
}

export async function getStatusSummary(kv: KvLike): Promise<StatusSummary> {
  const [inreach, email] = await Promise.all([
    readChannelStatus(kv, 'inreach'),
    readChannelStatus(kv, 'email'),
  ]);
  return { inreach, email };
}
