/**
 * Daily call budget for the Workers AI fuzzy matcher, backed by a KV counter.
 * Guarantees we stay inside the free 10,000-neuron/day tier (and well under it):
 * at ~2.3 neurons per AI call, capping daily calls keeps neuron spend bounded, and
 * it doubles as abuse protection (the AI only fires on a lookup miss, so a spammer
 * hitting the catch-all is the only realistic way to rack up calls).
 *
 * Fails CLOSED: if we can't read the counter we skip the AI call rather than risk
 * blowing the budget — the query just falls through to "not found", same as if the
 * AI tier weren't there. A write failure is tolerated (slight undercount is safe).
 */

export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

const TTL_SECONDS = 60 * 60 * 48; // keep the day's counter ~2 days, then auto-expire

export async function claimAiCall(
  kv: KvLike,
  maxPerDay: number,
  now: Date = new Date(),
): Promise<boolean> {
  const key = `ai:${now.toISOString().slice(0, 10)}`; // ai:YYYY-MM-DD (UTC)

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
