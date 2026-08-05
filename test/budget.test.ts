import { describe, expect, test, vi } from 'vitest';
import { claimAiCall, DAILY_AI_CAPS, TOTAL_DAILY_AI_CALLS, type AiIngress } from '../src/budget.js';

function kv(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    store,
    get: vi.fn(async (k: string) => store[k] ?? null),
    put: vi.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
  };
}

const day = new Date('2026-06-28T15:00:00Z');

describe('claimAiCall', () => {
  test('allows and increments when under the daily cap', async () => {
    const store = kv();
    expect(await claimAiCall(store, 'email', 1000, day)).toBe(true);
    expect(store.store['ai:email:2026-06-28']).toBe('1');
  });

  test('counts up from an existing value', async () => {
    const store = kv({ 'ai:email:2026-06-28': '41' });
    expect(await claimAiCall(store, 'email', 1000, day)).toBe(true);
    expect(store.store['ai:email:2026-06-28']).toBe('42');
  });

  test('refuses and does not write once the cap is reached', async () => {
    const store = kv({ 'ai:email:2026-06-28': '1000' });
    expect(await claimAiCall(store, 'email', 1000, day)).toBe(false);
    expect(store.put).not.toHaveBeenCalled();
  });

  test('uses a per-day key so the budget resets each day', async () => {
    const store = kv({ 'ai:email:2026-06-28': '1000' });
    // a new day → fresh count, allowed again
    expect(await claimAiCall(store, 'email', 1000, new Date('2026-06-29T00:01:00Z'))).toBe(true);
    expect(store.store['ai:email:2026-06-29']).toBe('1');
  });

  test('fails closed (skips AI) if the counter read errors — guarantees the cap', async () => {
    const broken = {
      get: vi.fn(async () => { throw new Error('kv down'); }),
      put: vi.fn(async () => {}),
    };
    expect(await claimAiCall(broken, 'email', 1000, day)).toBe(false);
  });

  // KV is schemaless — a garbage value must not read as NaN and silently defeat
  // the cap (NaN >= maxPerDay is false, so the call would sail through forever).
  test('treats a corrupt counter value as zero rather than NaN', async () => {
    const store = kv({ 'ai:email:2026-06-28': 'not-a-number' });
    expect(await claimAiCall(store, 'email', 1000, day)).toBe(true);
    expect(store.store['ai:email:2026-06-28']).toBe('1');
  });

  test('a write failure does not block the call (count just undercounts, still safe)', async () => {
    const half = {
      get: vi.fn(async () => '5'),
      put: vi.fn(async () => { throw new Error('write failed'); }),
    };
    expect(await claimAiCall(half, 'email', 1000, day)).toBe(true);
  });
});

// The point of the per-ingress split: a stranger flooding the toll-free number
// exhausts only the SMS allowance. Before this, one shared counter meant SMS
// gibberish could starve the InReach path of fuzzy matching.
describe('per-ingress isolation', () => {
  test('each ingress keeps its own counter', async () => {
    const store = kv();
    await claimAiCall(store, 'sms', 200, day);
    await claimAiCall(store, 'email', 800, day);
    expect(store.store['ai:sms:2026-06-28']).toBe('1');
    expect(store.store['ai:email:2026-06-28']).toBe('1');
  });

  test('an exhausted SMS budget leaves the email budget untouched', async () => {
    const store = kv({ 'ai:sms:2026-06-28': String(DAILY_AI_CAPS.sms) });
    expect(await claimAiCall(store, 'sms', DAILY_AI_CAPS.sms, day)).toBe(false);
    expect(await claimAiCall(store, 'email', DAILY_AI_CAPS.email, day)).toBe(true);
  });

  test('an exhausted email budget leaves the SMS budget untouched', async () => {
    const store = kv({ 'ai:email:2026-06-28': String(DAILY_AI_CAPS.email) });
    expect(await claimAiCall(store, 'email', DAILY_AI_CAPS.email, day)).toBe(false);
    expect(await claimAiCall(store, 'sms', DAILY_AI_CAPS.sms, day)).toBe(true);
  });
});

// The caps are only safe as a set — splitting a budget is exactly the change that
// invites "just add one more line". This pins the sum so a future ingress has to
// take its share from an existing one rather than inflate the total.
describe('DAILY_AI_CAPS invariant', () => {
  test('per-ingress caps sum to no more than the total daily allowance', () => {
    const sum = Object.values(DAILY_AI_CAPS).reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(TOTAL_DAILY_AI_CALLS);
  });

  test('every ingress has a positive cap', () => {
    const ingresses: AiIngress[] = ['email', 'sms'];
    for (const ingress of ingresses) {
      expect(DAILY_AI_CAPS[ingress]).toBeGreaterThan(0);
    }
  });
});
