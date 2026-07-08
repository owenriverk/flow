import { describe, expect, it, vi } from 'vitest';
import {
  buildSweepCheck,
  buildWatchdogCheck,
  SWEEP_KEY,
  WATCHDOG_STATE_KEY,
  type SweepSnapshot,
} from '../src/canarySweep.js';

const NOW = new Date('2026-07-02T14:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

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

interface RowOver {
  key?: string;
  source?: string;
  site?: string;
  discharge?: number | null;
  stage?: number | null;
  reading_time?: string | null;
}
const row = (over: RowOver = {}) => ({
  key: 'gauley',
  source: 'usgs',
  site: '03189100',
  discharge: 2800,
  stage: 4.2,
  reading_time: hoursAgo(1),
  ...over,
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sweepDeps(rows: unknown, over: Record<string, unknown> = {}) {
  return {
    supabaseUrl: 'https://x.supabase.co',
    anonKey: 'anon',
    kv: kv(),
    fetchFn: vi.fn(async () => jsonResponse(rows)) as unknown as typeof fetch,
    now: () => NOW,
    ...over,
  };
}

function snapshotFor(
  gauges: Record<string, { state: 'ok' | 'offline' | 'stale' | 'flatline'; readingTime: string | null }>,
): string {
  return JSON.stringify({ gauges } satisfies SweepSnapshot);
}

describe('gauge sweep', () => {
  it('first run records a baseline and alerts nothing, even with problems present', async () => {
    const store = kv();
    const check = buildSweepCheck(sweepDeps([row(), row({ key: 'dead', site: '999', discharge: null, stage: null })], { kv: store }));
    const result = await check.run();
    expect(result.status).toBe('findings'); // standing state visible
    expect(result.findings).toEqual([]); // but silent
    const written = JSON.parse(store.store[SWEEP_KEY]!) as SweepSnapshot;
    expect(written.gauges['usgs:999']!.state).toBe('offline');
  });

  it('fresh readings are ok with an ok summary', async () => {
    const check = buildSweepCheck(sweepDeps([row()], { kv: kv({ [SWEEP_KEY]: snapshotFor({}) }) }));
    const result = await check.run();
    expect(result.status).toBe('ok');
    expect(result.summary).toBe('1 gauges: 1 ok');
    expect(result.findings).toEqual([]);
  });

  it('null discharge+stage transitions ok -> offline and alerts', async () => {
    const store = kv({
      [SWEEP_KEY]: snapshotFor({ 'usgs:03189100': { state: 'ok', readingTime: hoursAgo(25) } }),
    });
    const check = buildSweepCheck(
      sweepDeps([row({ discharge: null, stage: null })], { kv: store }),
    );
    const result = await check.run();
    expect(result.status).toBe('findings');
    expect(result.findings).toEqual([
      `gauley (usgs:03189100): ok -> offline (last reading ${hoursAgo(1)})`,
    ]);
  });

  it('staleness budget is per source: 30h is stale for usgs, fine for wsc', async () => {
    const store = kv({ [SWEEP_KEY]: snapshotFor({}) });
    const rows = [
      row({ reading_time: hoursAgo(30) }),
      row({ key: 'stikine', source: 'wsc', site: '08CE001', reading_time: hoursAgo(30) }),
    ];
    const result = await buildSweepCheck(sweepDeps(rows, { kv: store })).run();
    expect(result.findings).toEqual([
      `gauley (usgs:03189100): ok -> stale (last reading ${hoursAgo(30)})`,
    ]);
  });

  it('frozen reading_time on a slow source is flatline, not stale', async () => {
    const frozen = hoursAgo(30);
    const store = kv({
      [SWEEP_KEY]: snapshotFor({ 'wsc:08CE001': { state: 'ok', readingTime: frozen } }),
    });
    const rows = [row({ key: 'stikine', source: 'wsc', site: '08CE001', reading_time: frozen })];
    const result = await buildSweepCheck(sweepDeps(rows, { kv: store })).run();
    expect(result.findings).toEqual([
      `stikine (wsc:08CE001): ok -> flatline (last reading ${frozen})`,
    ]);
  });

  it('a persisting problem stays silent on later nights', async () => {
    const store = kv({
      [SWEEP_KEY]: snapshotFor({ 'usgs:03189100': { state: 'offline', readingTime: null } }),
    });
    const result = await buildSweepCheck(
      sweepDeps([row({ discharge: null, stage: null })], { kv: store }),
    ).run();
    expect(result.status).toBe('findings'); // standing state still shown
    expect(result.findings).toEqual([]); // no repeat email
  });

  it('recovery transitions alert too', async () => {
    const store = kv({
      [SWEEP_KEY]: snapshotFor({ 'usgs:03189100': { state: 'offline', readingTime: null } }),
    });
    const result = await buildSweepCheck(sweepDeps([row()], { kv: store })).run();
    expect(result.status).toBe('ok');
    expect(result.findings).toEqual([
      `gauley (usgs:03189100): offline -> ok (last reading ${hoursAgo(1)})`,
    ]);
  });

  it('non-2xx from Supabase is a check error, not a throw', async () => {
    const result = await buildSweepCheck(
      sweepDeps(null, { fetchFn: vi.fn(async () => jsonResponse({ msg: 'nope' }, 500)) }),
    ).run();
    expect(result.status).toBe('error');
    expect(result.summary).toContain('HTTP 500');
  });

  it('network failure is a check error', async () => {
    const result = await buildSweepCheck(
      sweepDeps(null, {
        fetchFn: vi.fn(async () => {
          throw new Error('socket hang up');
        }),
      }),
    ).run();
    expect(result.status).toBe('error');
    expect(result.summary).toContain('socket hang up');
  });

  it('fails open when KV writes throw', async () => {
    const brokenKv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {
        throw new Error('kv down');
      }),
    };
    const result = await buildSweepCheck(sweepDeps([row()], { kv: brokenKv })).run();
    expect(result.status).toBe('ok');
  });
});

describe('email-canary watchdog', () => {
  function wdDeps(rpcBody: unknown, over: Record<string, unknown> = {}) {
    return {
      supabaseUrl: 'https://x.supabase.co',
      anonKey: 'anon',
      kv: kv(),
      fetchFn: vi.fn(async () => jsonResponse(rpcBody)) as unknown as typeof fetch,
      now: () => NOW,
      ...over,
    };
  }

  it('fresh canary row is ok', async () => {
    const result = await buildWatchdogCheck(wdDeps(hoursAgo(4))).run();
    expect(result.status).toBe('ok');
    expect(result.findings).toEqual([]);
  });

  it('stale canary alerts on the transition, then goes quiet', async () => {
    const store = kv();
    const deps = wdDeps(hoursAgo(72), { kv: store });
    const first = await buildWatchdogCheck(deps).run();
    expect(first.status).toBe('findings');
    expect(first.findings).toHaveLength(1);
    expect(first.findings![0]).toContain('72h');

    const second = await buildWatchdogCheck(deps).run();
    expect(second.status).toBe('findings');
    expect(second.findings).toEqual([]);
    expect(store.store[WATCHDOG_STATE_KEY]).toBe('stale');
  });

  it('recovery after staleness alerts once', async () => {
    const store = kv({ [WATCHDOG_STATE_KEY]: 'stale' });
    const result = await buildWatchdogCheck(wdDeps(hoursAgo(2), { kv: store })).run();
    expect(result.status).toBe('ok');
    expect(result.findings).toEqual(['email canary is running again']);
    expect(store.store[WATCHDOG_STATE_KEY]).toBe('ok');
  });

  it('missing RPC (pre-migration) is skipped, not an error', async () => {
    const result = await buildWatchdogCheck(
      wdDeps(null, { fetchFn: vi.fn(async () => jsonResponse({ msg: 'not found' }, 404)) }),
    ).run();
    expect(result.status).toBe('skipped');
    expect(result.summary).toContain('migration 008');
  });

  it('no canary rows yet is skipped', async () => {
    const result = await buildWatchdogCheck(wdDeps(null)).run();
    expect(result.status).toBe('skipped');
  });

  it('RPC failure is a check error', async () => {
    const result = await buildWatchdogCheck(
      wdDeps(null, { fetchFn: vi.fn(async () => jsonResponse('x', 500)) }),
    ).run();
    expect(result.status).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// trend baselines (v3 — flow_history-fed baseline_* columns)

import { buildTrendHealthCheck, TREND_STATE_KEY } from '../src/canarySweep.js';

interface TrendRowOver {
  key?: string;
  discharge?: number | null;
  reading_time?: string | null;
  baseline_reading_time?: string | null;
}
const trendRow = (over: TrendRowOver = {}) => ({
  key: 'gauley',
  discharge: 2800,
  reading_time: hoursAgo(1),
  baseline_reading_time: hoursAgo(24),
  ...over,
});

function trendCheck(rows: unknown, kvStore: Record<string, string> = {}, status = 200, body?: string) {
  const store = kv(kvStore);
  const fetchFn = vi.fn(async () =>
    body !== undefined
      ? new Response(body, { status })
      : jsonResponse(rows, status),
  ) as unknown as typeof fetch;
  const check = buildTrendHealthCheck({
    supabaseUrl: 'https://x.supabase.co',
    anonKey: 'anon',
    kv: store,
    fetchFn,
    now: () => NOW,
  });
  return { check, store };
}

describe('buildTrendHealthCheck', () => {
  it('reports ok when fresh gauges carry recent baselines', async () => {
    const { check } = trendCheck([
      trendRow(),
      trendRow({ key: 'kings', baseline_reading_time: hoursAgo(28) }),
    ]);
    const result = await check.run();
    expect(result.status).toBe('ok');
    expect(result.summary).toContain('2/2 fresh gauges');
    expect(result.findings).toEqual([]);
  });

  it('skips (never alerts) before migration 011 exists', async () => {
    const { check } = trendCheck(null, {}, 400, JSON.stringify({
      message: 'column gauges.baseline_reading_time does not exist',
    }));
    const result = await check.run();
    expect(result.status).toBe('skipped');
    expect(result.summary).toContain('not migrated');
  });

  it('skips while baselines warm up after deploy (all null)', async () => {
    const { check } = trendCheck([trendRow({ baseline_reading_time: null })]);
    const result = await check.run();
    expect(result.status).toBe('skipped');
    expect(result.summary).toContain('warming up');
  });

  it('ignores gauges whose source is dark (the sweep owns those)', async () => {
    const { check } = trendCheck([
      trendRow({ key: 'dead', discharge: null, baseline_reading_time: hoursAgo(90) }),
      trendRow({ key: 'stale-src', reading_time: hoursAgo(60), baseline_reading_time: hoursAgo(90) }),
      trendRow(),
    ]);
    const result = await check.run();
    expect(result.status).toBe('ok');
    expect(result.summary).toContain('1/1 fresh gauges');
  });

  it('flags stuck baselines once on transition, with the gauge named', async () => {
    const rows = [trendRow({ key: 'kings', baseline_reading_time: hoursAgo(40) }), trendRow()];
    const { check, store } = trendCheck(rows);
    const first = await check.run();
    expect(first.status).toBe('findings');
    expect(first.findings).toHaveLength(1);
    expect(first.findings![0]).toContain('kings');
    expect(store.store[TREND_STATE_KEY]).toBe('stale');

    // Standing state repeats without re-alerting.
    const { check: again } = trendCheck(rows, { [TREND_STATE_KEY]: 'stale' });
    const second = await again.run();
    expect(second.status).toBe('findings');
    expect(second.findings).toEqual([]);
  });

  it('announces recovery exactly once', async () => {
    const { check } = trendCheck([trendRow()], { [TREND_STATE_KEY]: 'stale' });
    const result = await check.run();
    expect(result.status).toBe('ok');
    expect(result.findings).toEqual(['trend baselines are promoting again']);
  });

  it('reports error (not findings) when the read fails outright', async () => {
    const { check } = trendCheck(null, {}, 500, 'oops');
    const result = await check.run();
    expect(result.status).toBe('error');
  });
});
