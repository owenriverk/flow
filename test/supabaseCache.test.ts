import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchCachedReading } from '../src/supabaseCache.js';

function stubRows(rows: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchCachedReading', () => {
  test('returns the current reading when discharge is present', async () => {
    stubRows([{
      discharge: 655, stage: null, discharge_unit: 'cfs', stage_unit: null,
      reading_time: '2026-07-04T13:00:00Z', prev_discharge: 700, prev_reading_time: '2026-07-03T13:00:00Z',
    }]);
    const r = await fetchCachedReading('https://x.supabase.co', 'k', 'dreamflows', '100');
    expect(r?.discharge).toBe(655);
    expect(r?.observedAt.toISOString()).toBe('2026-07-04T13:00:00.000Z');
  });

  test('falls back to prev_discharge when current discharge is null (gauge went dark)', async () => {
    stubRows([{
      discharge: null, stage: null, discharge_unit: 'cfs', stage_unit: null,
      reading_time: '2026-07-04T21:15:02Z', prev_discharge: 480, prev_reading_time: '2026-06-20T09:00:00Z',
    }]);
    const r = await fetchCachedReading('https://x.supabase.co', 'k', 'dreamflows', '111');
    expect(r?.discharge).toBe(480);
    expect(r?.observedAt.toISOString()).toBe('2026-06-20T09:00:00.000Z');
  });

  test('returns null when the row has never had a usable value', async () => {
    stubRows([{
      discharge: null, stage: null, discharge_unit: null, stage_unit: null,
      reading_time: '2026-07-04T21:15:02Z', prev_discharge: null, prev_reading_time: null,
    }]);
    expect(await fetchCachedReading('https://x.supabase.co', 'k', 'dreamflows', '111')).toBeNull();
  });

  test('returns null on missing row or HTTP error', async () => {
    stubRows([]);
    expect(await fetchCachedReading('https://x.supabase.co', 'k', 'usgs', '1')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    expect(await fetchCachedReading('https://x.supabase.co', 'k', 'usgs', '1')).toBeNull();
  });
});
