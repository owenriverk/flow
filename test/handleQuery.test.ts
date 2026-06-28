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

  test('every canned reply fits the 160-char satellite limit', () => {
    expect(NOT_FOUND.length).toBeLessThanOrEqual(160);
    expect(UNAVAILABLE.length).toBeLessThanOrEqual(160);
  });
});
