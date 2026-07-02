import { describe, expect, it } from 'vitest';
import aliasesJson from '../src/aliases.json' with { type: 'json' };
import type { GaugeAlias } from '../src/lookupGauge.js';
import {
  buildDigest,
  computeResolutions,
  dedupeLatest,
  diffResolutions,
  formatChanges,
  formatDigest,
  shouldSendDigest,
} from '../src/replayLogic.js';

const aliases = aliasesJson as Record<string, GaugeAlias>;

describe('dedupeLatest', () => {
  it('keeps the most recent row per query (rows arrive newest-first), normalized', () => {
    const rows = [
      { query: 'Selway ', resolved: true },
      { query: 'selway', resolved: false }, // older duplicate — dropped
      { query: 'mystery creek', resolved: false },
    ];
    expect(dedupeLatest(rows, 100)).toEqual([
      { query: 'selway', resolved: true },
      { query: 'mystery creek', resolved: false },
    ]);
  });

  it('caps the corpus and skips empty queries', () => {
    const rows = [
      { query: '', resolved: false },
      { query: 'a', resolved: false },
      { query: 'b', resolved: false },
      { query: 'c', resolved: false },
    ];
    expect(dedupeLatest(rows, 2)).toHaveLength(2);
  });
});

describe('computeResolutions', () => {
  it('resolves real alias phrasings to source:site and misses to null', () => {
    const resolutions = computeResolutions(
      [
        { query: 'selway', resolved: true },
        { query: 'checking selway before the trip', resolved: true }, // embedded match
        { query: 'definitely not a river', resolved: false },
      ],
      aliases,
    );
    expect(resolutions['selway']).toBe('usgs:13336500');
    expect(resolutions['checking selway before the trip']).toBe('usgs:13336500');
    expect(resolutions['definitely not a river']).toBeNull();
  });
});

describe('diffResolutions', () => {
  it('flags changed resolutions including regressions to null', () => {
    const prev = { selway: 'usgs:13336500', gauley: 'usgs:03189100' };
    const curr = { selway: 'usgs:99999999', gauley: null };
    expect(diffResolutions(prev, curr)).toEqual([
      { query: 'gauley', before: 'usgs:03189100', after: null },
      { query: 'selway', before: 'usgs:13336500', after: 'usgs:99999999' },
    ]);
  });

  it('brand-new queries baseline silently; stable AI-only misses (null->null) never alert', () => {
    const prev = { 'ai only phrasing': null };
    const curr = { 'ai only phrasing': null, 'new query tonight': null };
    expect(diffResolutions(prev, curr)).toEqual([]);
  });
});

describe('shouldSendDigest', () => {
  const sunday = new Date('2026-07-05T10:30:00Z'); // a Sunday
  const monday = new Date('2026-07-06T10:30:00Z');

  it('fires on Sundays when never sent or last sent over 6 days ago', () => {
    expect(shouldSendDigest(sunday, null)).toBe(true);
    expect(shouldSendDigest(sunday, '2026-06-21T10:30:00Z')).toBe(true);
  });

  it('does not fire twice in a week or on other days', () => {
    expect(shouldSendDigest(sunday, '2026-07-05T09:00:00Z')).toBe(false);
    expect(shouldSendDigest(monday, null)).toBe(false);
  });

  it('treats a garbled lastSent as never-sent', () => {
    expect(shouldSendDigest(sunday, 'not a date')).toBe(true);
  });
});

describe('buildDigest / formatDigest', () => {
  it('separates never-resolved from AI-carried queries', () => {
    const corpus = [
      { query: 'fuzzy run name', resolved: true }, // AI carried it; deterministic miss
      { query: 'gibberish', resolved: false },
      { query: 'selway', resolved: true }, // deterministic hit — not a candidate
    ];
    const resolutions = { 'fuzzy run name': null, gibberish: null, selway: 'usgs:13336500' };
    const digest = buildDigest(corpus, resolutions);
    expect(digest.aiCarried).toEqual(['fuzzy run name']);
    expect(digest.neverResolved).toEqual(['gibberish']);
    const text = formatDigest(digest);
    expect(text).toContain('fuzzy run name');
    expect(text).toContain('gibberish');
  });

  it('says so when there is nothing to do', () => {
    expect(formatDigest({ neverResolved: [], aiCarried: [] })).toContain('Nothing to do');
  });
});

describe('formatChanges', () => {
  it('prints before/after per query', () => {
    const text = formatChanges([{ query: 'gauley', before: 'usgs:03189100', after: null }]);
    expect(text).toContain('"gauley": usgs:03189100 -> NOT FOUND');
  });
});
