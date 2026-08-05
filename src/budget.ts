/**
 * Daily call budget for the Workers AI fuzzy matcher, backed by KV counters.
 * Guarantees we stay inside the free 10,000-neuron/day tier (and well under it):
 * at ~2.3 neurons per AI call, capping daily calls keeps neuron spend bounded, and
 * it doubles as abuse protection (the AI only fires on a lookup miss, so a spammer
 * hitting a public entry point is the only realistic way to rack up calls).
 *
 * Budgets are per INGRESS, not per reply channel. The distinction matters:
 * src/channels.ts's `Channel` describes where a reply goes *out*, and on the email
 * path that isn't known until handleInbound has already spent the AI call. Ingress
 * is what an abuser actually controls, and it's known at the call site. Before SMS
 * there was one shared counter, so a flood of gibberish texts could have exhausted
 * the allowance the InReach path depends on — a paddler in a canyon losing fuzzy
 * matching because a stranger spammed the toll-free number.
 *
 * Fails CLOSED: if we can't read the counter we skip the AI call rather than risk
 * blowing the budget — the query just falls through to "not found", same as if the
 * AI tier weren't there. A write failure is tolerated (slight undercount is safe).
 */

export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

/**
 * Where the query entered the system — the axis budgets are partitioned on.
 *   'email' — Cloudflare Email Routing catch-all (InReach replies, plain email, canary)
 *   'sms'   — the Twilio inbound webhook (POST /api/sms)
 */
export type AiIngress = 'email' | 'sms';

/**
 * Total daily AI calls we allow ourselves across all ingresses. ~2.3 neurons/call
 * against a free tier of 10,000 neurons/day leaves headroom of roughly 4x at this
 * ceiling; the margin is deliberate, since neuron cost per call is an estimate.
 */
export const TOTAL_DAILY_AI_CALLS = 1000;

/**
 * Per-ingress caps. Their SUM is the real constraint (see TOTAL_DAILY_AI_CALLS) —
 * test/budget.test.ts pins that invariant so a future channel can't be bolted on by
 * just adding a line here. Email carries the great majority of real traffic and the
 * nightly canary; SMS is deliberately the smaller share while it is personal-testing
 * only, and it is the share a stranger can reach.
 */
export const DAILY_AI_CAPS: Record<AiIngress, number> = {
  email: 800,
  sms: 200,
};

const TTL_SECONDS = 60 * 60 * 48; // keep the day's counter ~2 days, then auto-expire

export async function claimAiCall(
  kv: KvLike,
  ingress: AiIngress,
  maxPerDay: number,
  now: Date = new Date(),
): Promise<boolean> {
  // ai:<ingress>:YYYY-MM-DD (UTC). The pre-split key was `ai:YYYY-MM-DD`; on deploy
  // those orphaned counters simply expire via TTL, and both ingresses start the day
  // fresh. A one-time undercount on changeover day is harmless.
  const key = `ai:${ingress}:${now.toISOString().slice(0, 10)}`;

  let count: number;
  try {
    count = Number((await kv.get(key)) ?? '0');
  } catch {
    return false; // can't confirm budget → don't spend the neuron
  }
  if (!Number.isFinite(count)) count = 0;
  if (count >= maxPerDay) {
    console.warn(`AI budget: daily cap reached (${count}/${maxPerDay}, ${key}) — fuzzy match skipped`);
    return false;
  }

  try {
    await kv.put(key, String(count + 1), { expirationTtl: TTL_SECONDS });
  } catch {
    // tolerate a write failure: this call proceeds, the count just lags slightly.
  }
  return true;
}
