import { describe, expect, test } from 'vitest';
import { buildView, pickRiver, stateNote } from '../web/river-view.js';

/**
 * The four states a river page can be in. Unlike the homepage table, a river
 * page asks for ONE run, so "the key isn't in the response" is a real state —
 * before this existed it was an unhandled TypeError and a blank page.
 */

const NOW = Date.parse('2026-09-19T12:00:00Z');

const row = (over: Record<string, unknown> = {}) => ({
  key: 'mf salmon',
  name: 'Middle Fork Salmon',
  location: 'At MF Lodge, ID',
  text_key: 'mf salmon',
  gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13309220/',
  discharge: 2800,
  discharge_unit: 'cfs',
  stage: 4.21,
  stage_unit: 'ft',
  low: 2000,
  high: 7000,
  reading_time: '2026-09-19T11:30:00Z',
  baseline_discharge: 2800,
  baseline_reading_time: '2026-09-18T11:30:00Z',
  ...over,
});

describe('pickRiver', () => {
  test('finds the run by key', () => {
    expect(pickRiver([row({ key: 'other' }), row()], 'mf salmon')?.name).toBe('Middle Fork Salmon');
  });

  test('a missing key is null, not a throw', () => {
    expect(pickRiver([row()], 'nope')).toBeNull();
  });

  test('survives a null or non-array payload', () => {
    expect(pickRiver(null, 'mf salmon')).toBeNull();
    expect(pickRiver(undefined, 'mf salmon')).toBeNull();
    expect(pickRiver({} as never, 'mf salmon')).toBeNull();
  });

  test('skips null entries rather than dereferencing them', () => {
    expect(pickRiver([null, row()], 'mf salmon')?.key).toBe('mf salmon');
  });
});

describe('buildView — state (live)', () => {
  test('a healthy gauge renders a live reading with status and trend', () => {
    const v = buildView({ rows: [row()], cached: null, key: 'mf salmon', now: NOW });
    expect(v.state).toBe('live');
    expect(v.live).toBe(true);
    expect(v.flow).toBe('2,800 cfs / 4.21 ft');
    expect(v.status).toBe('good');
    expect(v.age?.label).toBe('30 min ago');
    expect(v.name).toBe('Middle Fork Salmon');
  });

  test('a low reading carries the low status through', () => {
    const v = buildView({ rows: [row({ discharge: 900 })], cached: null, key: 'mf salmon', now: NOW });
    expect(v.status).toBe('low');
  });
});

describe('buildView — state (offline)', () => {
  test('a dead gauge is offline, not a blank live reading', () => {
    const v = buildView({
      rows: [row({ discharge: null, stage: null })],
      cached: null,
      key: 'mf salmon',
      now: NOW,
    });
    expect(v.state).toBe('offline');
    expect(v.live).toBe(false);
    expect(stateNote(v)).toContain('not reporting');
  });

  // The trap: refresh-gauges stamps reading_time "now" on an empty read, so a
  // dead gauge arrives looking brand new. Timestamp freshness must not win.
  test('a dead gauge with a FRESH timestamp is still offline', () => {
    const v = buildView({
      rows: [row({ discharge: null, stage: null, reading_time: '2026-09-19T12:00:00Z' })],
      cached: null,
      key: 'mf salmon',
      now: NOW,
    });
    expect(v.state).toBe('offline');
  });
});

describe('buildView — state (cached)', () => {
  const cached = { rows: [row()], fetchedAt: '2026-09-19T09:00:00Z' };

  test('falls back to cache when the fetch failed', () => {
    const v = buildView({ rows: null, cached, key: 'mf salmon', now: NOW });
    expect(v.state).toBe('cached');
    expect(v.flow).toBe('2,800 cfs / 4.21 ft');
    expect(v.cachedAt).toBe('2026-09-19T09:00:00Z');
  });

  test('the note says plainly that it is saved, not live', () => {
    const v = buildView({ rows: null, cached, key: 'mf salmon', now: NOW });
    const note = stateNote(v);
    expect(note).toContain('saved reading');
    expect(note).toContain('could not reach live data');
  });

  test('live data always wins over cache', () => {
    const v = buildView({
      rows: [row({ discharge: 3500 })],
      cached,
      key: 'mf salmon',
      now: NOW,
    });
    expect(v.state).toBe('live');
    expect(v.flow).toContain('3,500');
  });

  test('a cache with no matching key is not a fallback', () => {
    const v = buildView({ rows: null, cached: { rows: [row({ key: 'other' })], fetchedAt: null }, key: 'mf salmon', now: NOW });
    expect(v.state).toBe('unavailable');
  });
});

describe('buildView — state (unavailable)', () => {
  test('fetch failed with no cache → unreachable, page still renders', () => {
    const v = buildView({ rows: null, cached: null, key: 'mf salmon', now: NOW });
    expect(v.state).toBe('unavailable');
    expect(v.reason).toBe('unreachable');
    expect(v.live).toBe(false);
    expect(stateNote(v)).toContain('text the bot');
  });

  // The case that used to throw: the API answered fine, but this page's key
  // is not in the roster (rename, typo, a run pulled in a compaction).
  test('fetch succeeded but the key is absent → missing-key, never a crash', () => {
    const v = buildView({ rows: [row({ key: 'grand canyon' })], cached: null, key: 'mf salmon', now: NOW });
    expect(v.state).toBe('unavailable');
    expect(v.reason).toBe('missing-key');
    expect(v.key).toBe('mf salmon');
  });

  test('an empty roster response is missing-key, not unreachable', () => {
    const v = buildView({ rows: [], cached: null, key: 'mf salmon', now: NOW });
    expect(v.reason).toBe('missing-key');
  });
});

describe('the two Salmon pages that share one gauge', () => {
  // Main and Lower read USGS 13317000 (White Bird) but are separate rows, so
  // each page names its own trip and carries its own runnable range.
  const white = (over: Record<string, unknown>) =>
    row({ location: 'At White Bird, ID', discharge: 4000, stage: null, ...over });

  test('each page shows its own name for the same reading', () => {
    const rows = [
      white({ key: 'main salmon', name: 'Main Salmon', low: 5000, high: 20000 }),
      white({ key: 'lower salmon', name: 'Lower Salmon', low: 3000, high: 20000 }),
    ];
    expect(buildView({ rows, cached: null, key: 'main salmon', now: NOW }).name).toBe('Main Salmon');
    expect(buildView({ rows, cached: null, key: 'lower salmon', now: NOW }).name).toBe('Lower Salmon');
  });

  test('and its own status, which is the whole reason for the split', () => {
    const rows = [
      white({ key: 'main salmon', name: 'Main Salmon', low: 5000, high: 20000 }),
      white({ key: 'lower salmon', name: 'Lower Salmon', low: 3000, high: 20000 }),
    ];
    // 4,000 cfs is below the Main's range but inside the Lower's.
    expect(buildView({ rows, cached: null, key: 'main salmon', now: NOW }).status).toBe('low');
    expect(buildView({ rows, cached: null, key: 'lower salmon', now: NOW }).status).toBe('good');
  });
});
