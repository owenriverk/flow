import { describe, expect, test, vi } from 'vitest';
import {
  recordReplySuccess,
  recordReplyFailure,
  shouldEscalate,
  getStatusSummary,
} from '../src/statusTracking.js';

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

const t1 = new Date('2026-06-30T12:00:00Z');
const t2 = new Date('2026-06-30T12:15:00Z');

describe('recordReplySuccess', () => {
  test('writes last-success timestamp and resets the failure counter', async () => {
    const store = kv({ 'status:inreach:consecutive_failures': '4' });
    await recordReplySuccess(store, 'inreach', t1);
    expect(store.store['status:inreach:last_success_at']).toBe(t1.toISOString());
    expect(store.store['status:inreach:consecutive_failures']).toBe('0');
  });

  test('a KV write failure does not throw', async () => {
    const broken = { get: vi.fn(), put: vi.fn(async () => { throw new Error('down'); }) };
    await expect(recordReplySuccess(broken, 'email', t1)).resolves.toBeUndefined();
  });
});

describe('recordReplyFailure', () => {
  test('starts a fresh channel at count 1', async () => {
    const store = kv();
    expect(await recordReplyFailure(store, 'inreach', 'boom', t1)).toBe(1);
    expect(store.store['status:inreach:last_failure_at']).toBe(t1.toISOString());
    expect(store.store['status:inreach:last_failure_detail']).toBe('boom');
  });

  test('increments across calls', async () => {
    const store = kv({ 'status:inreach:consecutive_failures': '2' });
    expect(await recordReplyFailure(store, 'inreach', 'boom again', t2)).toBe(3);
  });

  test('channels are tracked independently', async () => {
    const store = kv({ 'status:inreach:consecutive_failures': '5' });
    expect(await recordReplyFailure(store, 'email', 'smtp hiccup', t1)).toBe(1);
  });

  test('truncates an overlong detail so KV never gets an unbounded write', async () => {
    const store = kv();
    await recordReplyFailure(store, 'inreach', 'x'.repeat(1000), t1);
    expect(store.store['status:inreach:last_failure_detail']?.length).toBe(500);
  });

  test('returns 1 (assume the worst) if KV is unreachable, rather than throwing', async () => {
    const broken = {
      get: vi.fn(async () => { throw new Error('kv down'); }),
      put: vi.fn(async () => {}),
    };
    expect(await recordReplyFailure(broken, 'inreach', 'boom', t1)).toBe(1);
  });
});

describe('shouldEscalate', () => {
  test.each([
    [1, false],
    [2, false],
    [3, true],
    [4, false],
    [7, false],
    [8, true],
    [12, false],
    [13, true],
  ])('%i consecutive failures → escalate=%s', (count, expected) => {
    expect(shouldEscalate(count)).toBe(expected);
  });
});

describe('getStatusSummary', () => {
  test('reflects all three channels independently', async () => {
    const store = kv({
      'status:inreach:last_success_at': t1.toISOString(),
      'status:inreach:consecutive_failures': '0',
      'status:email:last_failure_at': t2.toISOString(),
      'status:email:last_failure_detail': 'SEND_EMAIL rejected',
      'status:email:consecutive_failures': '2',
      'status:canary:last_success_at': t2.toISOString(),
    });
    const summary = await getStatusSummary(store);
    expect(summary.inreach.lastSuccessAt).toBe(t1.toISOString());
    expect(summary.inreach.consecutiveFailures).toBe(0);
    expect(summary.email.lastFailureAt).toBe(t2.toISOString());
    expect(summary.email.lastFailureDetail).toBe('SEND_EMAIL rejected');
    expect(summary.email.consecutiveFailures).toBe(2);
    expect(summary.canary.lastSuccessAt).toBe(t2.toISOString());
  });

  test("the 'canary' channel records like any other", async () => {
    const store = kv();
    await recordReplySuccess(store, 'canary', t1);
    expect(store.store['status:canary:last_success_at']).toBe(t1.toISOString());
    expect(await recordReplyFailure(store, 'canary', 'imap down', t2)).toBe(1);
  });

  test('surfaces the nightly self-check blob when present', async () => {
    const store = kv({
      'canary:results': JSON.stringify({
        lastRunAt: t1.toISOString(),
        checks: { 'gauge sweep': { status: 'ok', summary: '35 gauges: 35 ok', at: t1.toISOString() } },
      }),
    });
    const summary = await getStatusSummary(store);
    expect(summary.selfCheck.lastRunAt).toBe(t1.toISOString());
    expect(summary.selfCheck.checks['gauge sweep']!.status).toBe('ok');
  });

  test('a garbled self-check blob degrades to empty, never throws', async () => {
    const store = kv({ 'canary:results': 'not json{' });
    const summary = await getStatusSummary(store);
    expect(summary.selfCheck).toEqual({ lastRunAt: null, checks: {} });
  });

  test('an unreachable KV still returns a well-formed summary (all nulls/zeros)', async () => {
    const broken = { get: vi.fn(async () => { throw new Error('down'); }), put: vi.fn() };
    const summary = await getStatusSummary(broken);
    const empty = { lastSuccessAt: null, lastFailureAt: null, lastFailureDetail: null, consecutiveFailures: 0 };
    expect(summary).toEqual({
      inreach: empty,
      email: empty,
      canary: empty,
      selfCheck: { lastRunAt: null, checks: {} },
    });
  });
});
