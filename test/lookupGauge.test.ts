import { describe, expect, test } from 'vitest';
import { lookupGauge, type GaugeAlias } from '../src/lookupGauge.js';

const aliases: Record<string, GaugeAlias> = {
  'gauley summersville': { site: '03189100', name: 'Gauley R', location: 'Summersville, WV' },
  'green narrows': { site: '03451500', name: 'Green R', location: 'Tuxedo, NC' },
  stikine: { site: '08CE001', name: 'Stikine R', location: 'Telegraph Creek, BC', source: 'wsc' },
  'fantasy falls': {
    site: 'NSS', name: 'NF Mokelumne', location: 'Salt Springs, CA', source: 'cdec', sensor: 76,
  },
  salt: { site: '09498500', name: 'Salt R', location: 'Roosevelt, AZ' },
  'salt river': { site: '09497500', name: 'Salt R upper', location: 'Chrysotile, AZ' },
  'grand canyon': { site: '09380000', name: 'Colorado R (Grand Canyon)', location: 'Lees Ferry, AZ' },
};

describe('lookupGauge', () => {
  test('resolves an exact curated alias to its gauge ref (source defaults to usgs)', () => {
    expect(lookupGauge('gauley summersville', aliases)).toEqual({
      site: '03189100',
      source: 'usgs',
      name: 'Gauley R',
      location: 'Summersville, WV',
    });
  });

  test('carries an explicit wsc source from the alias entry', () => {
    expect(lookupGauge('stikine', aliases)).toEqual({
      site: '08CE001',
      source: 'wsc',
      name: 'Stikine R',
      location: 'Telegraph Creek, BC',
    });
  });

  test('carries cdec source and per-station sensor config from the alias', () => {
    expect(lookupGauge('fantasy falls', aliases)).toEqual({
      site: 'NSS',
      source: 'cdec',
      name: 'NF Mokelumne',
      location: 'Salt Springs, CA',
      sensor: 76,
    });
  });

  test('matches aliases case-insensitively and tolerates messy whitespace', () => {
    expect(lookupGauge('  Gauley   Summersville ', aliases)).toEqual({
      site: '03189100',
      source: 'usgs',
      name: 'Gauley R',
      location: 'Summersville, WV',
    });
  });

  test('treats a bare 8-digit string as a raw USGS site id', () => {
    expect(lookupGauge('03189100', aliases)).toEqual({ site: '03189100', source: 'usgs' });
  });

  test('accepts longer all-digit USGS ids (some sites have 9-15 digits)', () => {
    expect(lookupGauge('011058837', aliases)).toEqual({ site: '011058837', source: 'usgs' });
  });

  test('recognizes a raw WSC station number, normalized to uppercase', () => {
    expect(lookupGauge('08ce001', aliases)).toEqual({ site: '08CE001', source: 'wsc' });
  });

  test('phrase-contains: resolves a known run name embedded in a longer message', () => {
    expect(lookupGauge('running gauley summersville tomorrow', aliases)).toEqual({
      site: '03189100',
      source: 'usgs',
      name: 'Gauley R',
      location: 'Summersville, WV',
    });
  });

  test('phrase-contains: handles a trailing qualifier ("at the dam")', () => {
    expect(lookupGauge('gauley summersville at the dam', aliases)).toMatchObject({ site: '03189100' });
  });

  test('phrase match is whole-word: "assault" does not match the "salt" run', () => {
    expect(lookupGauge('assault on the river', aliases)).toBeNull();
  });

  test('phrase-contains prefers the longest matching run name', () => {
    // "salt river canyon" contains both "salt" and "salt river" — the longer wins.
    expect(lookupGauge('salt river canyon trip', aliases)).toMatchObject({ site: '09497500' });
  });

  test('exact match still takes priority over phrase scanning', () => {
    expect(lookupGauge('stikine', aliases)).toMatchObject({ site: '08CE001', source: 'wsc' });
  });

  test('returns null for an unknown name', () => {
    expect(lookupGauge('mystery creek', aliases)).toBeNull();
  });

  test('ambiguous: two non-nested matches pointing at different gauges do not guess', () => {
    // "stikine" and "grand canyon" both match independently here (different rivers,
    // neither substring is nested inside the other's match). Silently picking the
    // textually longer one is the exact bug this guards against: a paddler asking
    // about the Stikine got back Colorado River flow with no indication of an error.
    expect(lookupGauge('stikine grand canyon', aliases)).toBeNull();
  });

  test('ambiguous case still returns null even with a typo alongside the real name', () => {
    expect(lookupGauge('stikine rivr grand canyon', aliases)).toBeNull();
  });

  test('not ambiguous: a match nested inside a longer match is not competing evidence', () => {
    // "salt" is a strict prefix-nested substring of "salt river"'s match here, so it
    // doesn't count as an independent, disagreeing candidate.
    expect(lookupGauge('salt river canyon trip', aliases)).toMatchObject({ site: '09497500' });
  });

  test('returns null for empty or whitespace-only input', () => {
    expect(lookupGauge('', aliases)).toBeNull();
    expect(lookupGauge('   ', aliases)).toBeNull();
  });
});
