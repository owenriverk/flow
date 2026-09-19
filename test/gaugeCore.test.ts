import { describe, expect, test, vi } from 'vitest';
import {
  CACHE_KEY,
  OFFLINE_HRS,
  STALE_WARN_HRS,
  TREND_THRESHOLD,
  ageInfo,
  escapeHtml,
  fetchGauges,
  flowText,
  readCache,
  rowClass,
  trendInfo,
  writeCache,
} from '../web/gauge-core.js';

/**
 * REGRESSION SUITE. These functions ran on the homepage gauge table for months
 * before they moved into gauge-core.js (2026-09-19) so the river pages could
 * share them. Every assertion here pins behavior that was already shipping —
 * if one fails, the extraction changed what paddlers read on lateboof.com.
 */

// A fresh, healthy cfs gauge. Each test overrides only what it is about.
const gauge = (over: Record<string, unknown> = {}) => ({
  key: 'mf-salmon',
  name: 'Middle Fork Salmon',
  location: 'At MF Lodge, ID',
  text_key: 'mf salmon',
  discharge: 2800,
  discharge_unit: 'cfs',
  stage: 4.21,
  stage_unit: 'ft',
  low: 1000,
  high: 5000,
  reading_time: '2026-09-19T12:00:00Z',
  baseline_discharge: 2800,
  baseline_reading_time: '2026-09-18T12:00:00Z',
  ...over,
});

const NOW = Date.parse('2026-09-19T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe('ageInfo', () => {
  test('fresh readings read as minutes, not hours', () => {
    expect(ageInfo(gauge({ reading_time: hoursAgo(0) }), NOW).label).toBe('just now');
    expect(ageInfo(gauge({ reading_time: hoursAgo(0.5) }), NOW).label).toBe('30 min ago');
    expect(ageInfo(gauge({ reading_time: hoursAgo(1.2) }), NOW)).toEqual({ label: '1 hr ago', cls: '' });
  });

  test(`>= ${STALE_WARN_HRS}h is flagged stale but still shown`, () => {
    expect(ageInfo(gauge({ reading_time: hoursAgo(3) }), NOW)).toEqual({
      label: '3 hr ago',
      cls: 'age-stale',
    });
  });

  test(`>= ${OFFLINE_HRS}h is [OFFLINE]`, () => {
    expect(ageInfo(gauge({ reading_time: hoursAgo(80) }), NOW)).toEqual({
      label: '[OFFLINE]',
      cls: 'age-offline',
    });
  });

  // The trap the source comment documents: refresh-gauges stamps reading_time
  // as "now" even when the source returned nothing, so a dead gauge arrives
  // looking brand new. Trusting the timestamp would show a blank as "just now".
  test('a null reading with a FRESH timestamp is still [OFFLINE]', () => {
    const dead = gauge({ discharge: null, stage: null, reading_time: hoursAgo(0) });
    expect(ageInfo(dead, NOW)).toEqual({ label: '[OFFLINE]', cls: 'age-offline' });
  });

  test('a missing timestamp reads as unknown, not as old', () => {
    expect(ageInfo(gauge({ reading_time: null }), NOW)).toEqual({ label: '—', cls: 'age-offline' });
  });
});

describe('rowClass', () => {
  test('in range is good, outside is low/high', () => {
    expect(rowClass(gauge())).toBe('good');
    expect(rowClass(gauge({ discharge: 900 }))).toBe('low');
    expect(rowClass(gauge({ discharge: 5100 }))).toBe('high');
  });

  test('boundary readings count as in range', () => {
    expect(rowClass(gauge({ discharge: 1000 }))).toBe('good');
    expect(rowClass(gauge({ discharge: 5000 }))).toBe('good');
  });

  // Both "no reading" and "no range configured" go to grey on purpose, so
  // neither vanishes from every status filter (including "No data").
  test('grey covers no reading AND no configured range', () => {
    expect(rowClass(gauge({ discharge: null, stage: null }))).toBe('grey');
    expect(rowClass(gauge({ low: null, high: null }))).toBe('grey');
    expect(rowClass(gauge({ discharge: null }))).toBe('grey');
  });
});

describe('flowText', () => {
  test('cfs rounds to whole numbers and appends stage', () => {
    expect(flowText(gauge({ discharge: 2800.4 }))).toBe('2,800 cfs / 4.21 ft');
  });

  test('cms keeps one decimal — WSC rivers run small numbers', () => {
    expect(flowText(gauge({ discharge: 108.34, discharge_unit: 'cms', stage: 2.45, stage_unit: 'm' })))
      .toBe('108.3 cms / 2.45 m');
  });

  test('discharge alone omits the stage half', () => {
    expect(flowText(gauge({ stage: null }))).toBe('2,800 cfs');
  });

  test('stage-only gauges still render a reading', () => {
    expect(flowText(gauge({ discharge: null }))).toBe('4.21 ft');
  });

  test('nothing at all is an em dash, never blank or NaN', () => {
    expect(flowText(gauge({ discharge: null, stage: null }))).toBe('—');
  });
});

describe('trendInfo', () => {
  test('a real rise is an up arrow with a percentage', () => {
    const t = trendInfo(gauge({ discharge: 3360, baseline_discharge: 2800 }));
    expect(t?.glyph).toBe('↑');
    expect(t?.cls).toBe('trend-up');
    expect(t?.title).toContain('+20%');
  });

  test('a real drop is a down arrow', () => {
    const t = trendInfo(gauge({ discharge: 2240, baseline_discharge: 2800 }));
    expect(t?.glyph).toBe('↓');
    expect(t?.cls).toBe('trend-down');
    expect(t?.title).toContain('-20%');
  });

  test(`swings under ${TREND_THRESHOLD * 100}% are jitter, not a trend`, () => {
    expect(trendInfo(gauge({ discharge: 2828, baseline_discharge: 2800 }))).toBeNull();
    expect(trendInfo(gauge({ discharge: 2772, baseline_discharge: 2800 }))).toBeNull();
  });

  test('no arrow without a usable baseline', () => {
    expect(trendInfo(gauge({ baseline_discharge: null }))).toBeNull();
    expect(trendInfo(gauge({ baseline_discharge: 0 }))).toBeNull();
    expect(trendInfo(gauge({ discharge: null }))).toBeNull();
  });

  test('a missing baseline timestamp still yields an arrow, just no "vs yesterday"', () => {
    const t = trendInfo(gauge({ discharge: 3360, baseline_reading_time: null }));
    expect(t?.glyph).toBe('↑');
    expect(t?.title).toBe('+20%');
  });

  // The diurnal-safe contract: baseline_* is a ~24h same-time-of-day reading.
  // prev_* is the bot's outage fallback and would make the arrow track the
  // daily melt cycle (perpetual morning drop) instead of day-over-day change.
  test('reads baseline_*, never prev_*', () => {
    const g = gauge({ discharge: 3360, baseline_discharge: 2800, prev_discharge: 3360 });
    expect(trendInfo(g)?.title).toContain('+20%');
    // prev_* alone must not produce an arrow
    expect(trendInfo(gauge({ baseline_discharge: null, prev_discharge: 1000 }))).toBeNull();
  });
});

describe('escapeHtml', () => {
  test('neutralizes every character that could break out of markup', () => {
    expect(escapeHtml(`<script>alert("x")&'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;',
    );
  });

  test('null and undefined render as empty, not as the words', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('cache helpers', () => {
  test('round-trip through a working localStorage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    writeCache([gauge()]);
    expect(store.has(CACHE_KEY)).toBe(true);
    expect(readCache()?.rows).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  // Private-mode Safari throws on write; a broken cache must never break a page.
  test('a throwing localStorage degrades instead of propagating', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceeded'); },
    });
    expect(() => writeCache([gauge()])).not.toThrow();
    expect(readCache()).toBeNull();
    vi.unstubAllGlobals();
  });

  test('unparseable cached JSON reads as empty, not as a crash', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{not json', setItem: () => {} });
    expect(readCache()).toBeNull();
    vi.unstubAllGlobals();
  });

  test('no localStorage at all (node, SSR) is survivable', () => {
    expect(readCache()).toBeNull();
    expect(() => writeCache([gauge()])).not.toThrow();
  });
});

describe('fetchGauges', () => {
  test('asks for the whole roster so every page shares one cache entry', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => [gauge()],
    }));
    const rows = await fetchGauges(fetchFn as unknown as typeof fetch);
    expect(rows).toHaveLength(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://vfkoegvzllxvshcnfbox.supabase.co/rest/v1/gauges?select=*');
    expect((init!.headers as Record<string, string>).apikey).toBeTruthy();
  });

  test('a non-2xx throws so callers hit the same path as a network failure', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    await expect(fetchGauges(fetchFn as unknown as typeof fetch)).rejects.toThrow('HTTP 503');
  });
});
