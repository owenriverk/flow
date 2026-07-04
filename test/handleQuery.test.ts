import { describe, expect, test, vi } from 'vitest';
import { handleQuery, NOT_FOUND, UNAVAILABLE } from '../src/handleQuery.js';
import type { GaugeAlias } from '../src/lookupGauge.js';
import type { Reading } from '../src/formatReply.js';
import { GaugeError } from '../src/errors.js';

const aliases: Record<string, GaugeAlias> = {
  'gauley summersville': { site: '03189100', name: 'Gauley R', location: 'Summersville, WV' },
  stikine: { site: '08CE001', name: 'Stikine R', location: 'Telegraph Creek, BC', source: 'wsc' },
  'fantasy falls': {
    site: 'NSS', name: 'NF Mokelumne', location: 'Salt Springs, CA', source: 'cdec', sensor: 76, dur: 'D',
  },
  'middle kings': { site: '100', name: 'Kings R', location: 'Rodgers Crossing, CA', source: 'dreamflows' },
  wairaurahiri: {
    site: 'Wairaurahiri at Lake Hauroko',
    name: 'Wairaurahiri R',
    location: 'At Lake Hauroko outlet, Southland, NZ',
    source: 'envdata',
  },
  'roaring billy': {
    site: '61',
    name: 'Landsborough R',
    location: 'Via Haast R gauge at Roaring Billy, West Coast, NZ',
    source: 'flowrate',
  },
};

const reading: Reading = {
  discharge: 2800,
  stage: 4.21,
  observedAt: new Date('2026-06-27T20:45:00Z'),
  offsetMinutes: -240,
  usgsName: 'GREEN RIVER NEAR TUXEDO, NC',
};

function deps(over: Partial<Parameters<typeof handleQuery>[1]> = {}) {
  return {
    aliases,
    fetchUsgs: vi.fn(async () => reading),
    fetchWsc: vi.fn(async () => reading),
    fetchCdec: vi.fn(async () => reading),
    fetchDreamflows: vi.fn(async () => reading),
    fetchEnvdata: vi.fn(async () => reading),
    fetchFlowrate: vi.fn(async () => reading),
    ...over,
  };
}

describe('handleQuery', () => {
  test('returns a formatted reply for a known USGS run name', async () => {
    const d = deps();
    const out = await handleQuery('gauley summersville', d);
    expect(d.fetchUsgs).toHaveBeenCalledWith('03189100');
    expect(d.fetchWsc).not.toHaveBeenCalled();
    expect(out).toContain('Gauley R, Summersville, WV');
    expect(out).toContain('2,800 cfs / 4.21 ft');
  });

  test('routes a WSC-sourced run to the WSC fetcher, not USGS', async () => {
    const d = deps();
    const out = await handleQuery('stikine', d);
    expect(d.fetchWsc).toHaveBeenCalledWith('08CE001');
    expect(d.fetchUsgs).not.toHaveBeenCalled();
    expect(out).toContain('WSC 08CE001');
  });

  test('routes a raw WSC station id to the WSC fetcher', async () => {
    const d = deps();
    await handleQuery('10EB001', d);
    expect(d.fetchWsc).toHaveBeenCalledWith('10EB001');
    expect(d.fetchUsgs).not.toHaveBeenCalled();
  });

  test('routes a dreamflows run to the Dreamflows fetcher by river id', async () => {
    const d = deps();
    const out = await handleQuery('middle kings', d);
    expect(d.fetchDreamflows).toHaveBeenCalledWith('100');
    expect(d.fetchUsgs).not.toHaveBeenCalled();
    expect(d.fetchWsc).not.toHaveBeenCalled();
    expect(out).toContain('Dreamflows 100');
  });

  test('routes an envdata run to the envdata fetcher by site name', async () => {
    const d = deps();
    const out = await handleQuery('wairaurahiri', d);
    expect(d.fetchEnvdata).toHaveBeenCalledWith('Wairaurahiri at Lake Hauroko');
    expect(d.fetchUsgs).not.toHaveBeenCalled();
    expect(out).toContain('ES Wairaurahiri at Lake Hauroko');
  });

  test('routes a flowrate run to the flowrate fetcher by station id', async () => {
    const d = deps();
    const out = await handleQuery('roaring billy', d);
    expect(d.fetchFlowrate).toHaveBeenCalledWith('61');
    expect(d.fetchUsgs).not.toHaveBeenCalled();
    expect(out).toContain('FlowRate 61');
  });

  test('routes a cdec run to the CDEC fetcher with its sensor + dur config', async () => {
    const d = deps();
    const out = await handleQuery('fantasy falls', d);
    expect(d.fetchCdec).toHaveBeenCalledWith('NSS', { sensor: 76, dur: 'D' });
    expect(d.fetchUsgs).not.toHaveBeenCalled();
    expect(d.fetchWsc).not.toHaveBeenCalled();
    expect(out).toContain('CDEC NSS');
  });

  test('routes a raw USGS id to the USGS fetcher', async () => {
    const d = deps();
    await handleQuery('03451500', d);
    expect(d.fetchUsgs).toHaveBeenCalledWith('03451500');
  });

  test('replies NOT_FOUND for an unknown name without calling any fetcher', async () => {
    const d = deps();
    const out = await handleQuery('mystery creek', d);
    expect(out).toBe(NOT_FOUND);
    expect(d.fetchUsgs).not.toHaveBeenCalled();
    expect(d.fetchWsc).not.toHaveBeenCalled();
  });

  test('replies NOT_FOUND when the source reports a bad id', async () => {
    const d = deps({
      fetchUsgs: vi.fn(async () => {
        throw new GaugeError('not_found', 'no such gauge');
      }),
    });
    expect(await handleQuery('99999999', d)).toBe(NOT_FOUND);
  });

  test('replies UNAVAILABLE when the source is down (never silent)', async () => {
    const d = deps({
      fetchUsgs: vi.fn(async () => {
        throw new GaugeError('unavailable', 'USGS returned 503');
      }),
    });
    expect(await handleQuery('gauley summersville', d)).toBe(UNAVAILABLE);
  });

  test('replies UNAVAILABLE on any unexpected error rather than throwing', async () => {
    const d = deps({
      fetchUsgs: vi.fn(async () => {
        throw new TypeError('boom');
      }),
    });
    expect(await handleQuery('gauley summersville', d)).toBe(UNAVAILABLE);
  });

  test('falls back to the AI fuzzy matcher when lookup misses, then resolves', async () => {
    const resolveFuzzy = vi.fn(async () => 'gauley summersville');
    const d = deps({ resolveFuzzy });
    const out = await handleQuery('the gauley', d);
    expect(resolveFuzzy).toHaveBeenCalledWith('the gauley');
    expect(d.fetchUsgs).toHaveBeenCalledWith('03189100');
    expect(out).toContain('Gauley R');
  });

  test('AI returns no match → NOT_FOUND', async () => {
    const resolveFuzzy = vi.fn(async () => null);
    expect(await handleQuery('zzz total nonsense', deps({ resolveFuzzy }))).toBe(NOT_FOUND);
  });

  test('exact match short-circuits — the AI matcher is never called', async () => {
    const resolveFuzzy = vi.fn(async () => 'gauley summersville');
    await handleQuery('gauley summersville', deps({ resolveFuzzy }));
    expect(resolveFuzzy).not.toHaveBeenCalled();
  });

  test('every canned reply fits the 160-char satellite limit', () => {
    expect(NOT_FOUND.length).toBeLessThanOrEqual(160);
    expect(UNAVAILABLE.length).toBeLessThanOrEqual(160);
  });

  // Regression: Dreamflows drops dormant gauges from its CSV, which surfaces as a
  // fetch-stage not_found. For an alias-resolved gauge that is a data outage, not
  // a typo — the reply must be last-good cached data (with a warning), never
  // "check your spelling".
  test('curated run + fetch not_found → cached last-good reading with stale warning', async () => {
    const cached: Reading = {
      discharge: 480,
      observedAt: new Date(Date.now() - 3 * 3_600_000),
      offsetMinutes: 0,
    };
    const d = deps({
      fetchDreamflows: vi.fn(async () => {
        throw new GaugeError('not_found', 'gauge 100 not found in CSV');
      }),
      fetchCached: vi.fn(async () => cached),
    });
    const out = await handleQuery('middle kings', d);
    expect(d.fetchCached).toHaveBeenCalledWith('dreamflows', '100');
    expect(out).toContain('Kings R');
    expect(out).toContain('480 cfs');
    expect(out).toContain('no fresh data; cached 3 hr ago');
    expect(out.length).toBeLessThanOrEqual(160);
  });

  test('curated run + fetch not_found + empty cache → UNAVAILABLE, not NOT_FOUND', async () => {
    const d = deps({
      fetchDreamflows: vi.fn(async () => {
        throw new GaugeError('not_found', 'gauge 100 not found in CSV');
      }),
      fetchCached: vi.fn(async () => null),
    });
    expect(await handleQuery('middle kings', d)).toBe(UNAVAILABLE);
  });

  test('curated run + fetch not_found with no cache wired → UNAVAILABLE', async () => {
    const d = deps({
      fetchDreamflows: vi.fn(async () => {
        throw new GaugeError('not_found', 'gauge 100 not found in CSV');
      }),
    });
    expect(await handleQuery('middle kings', d)).toBe(UNAVAILABLE);
  });
});
