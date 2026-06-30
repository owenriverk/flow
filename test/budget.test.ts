import { describe, expect, test, vi } from 'vitest';
import { claimAiCall } from '../src/budget.js';

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
    expect(await claimAiCall(store, 1000, day)).toBe(true);
    expect(store.store['ai:2026-06-28']).toBe('1');
  });

  test('counts up from an existing value', async () => {
    const store = kv({ 'ai:2026-06-28': '41' });
    expect(await claimAiCall(store, 1000, day)).toBe(true);
    expect(store.store['ai:2026-06-28']).toBe('42');
  });

  test('refuses and does not write once the cap is reached', async () => {
    const store = kv({ 'ai:2026-06-28': '1000' });
    expect(await claimAiCall(store, 1000, day)).toBe(false);
    expect(store.put).not.toHaveBeenCalled();
  });

  test('uses a per-day key so the budget resets each day', async () => {
    const store = kv({ 'ai:2026-06-28': '1000' });
    // a new day → fresh count, allowed again
    expect(await claimAiCall(store, 1000, new Date('2026-06-29T00:01:00Z'))).toBe(true);
    expect(store.store['ai:2026-06-29']).toBe('1');
  });

  test('fails closed (skips AI) if the counter read errors — guarantees the cap', async () => {
    const broken = {
      get: vi.fn(async () => { throw new Error('kv down'); }),
      put: vi.fn(async () => {}),
    };
    expect(await claimAiCall(broken, 1000, day)).toBe(false);
  });

  test('a write failure does not block the call (count just undercounts, still safe)', async () => {
    const half = {
      get: vi.fn(async () => '5'),
      put: vi.fn(async () => { throw new Error('write failed'); }),
    };
    expect(await claimAiCall(half, 1000, day)).toBe(true);
  });
});
