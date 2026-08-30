import { describe, expect, test } from 'vitest';
import { lookupGauge, type GaugeAlias } from '../src/lookupGauge.js';
import realAliasesJson from '../src/aliases.json' with { type: 'json' };

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

// The two blocks below run against the REAL roster, not the fixture above: both
// behaviours depend on aliases that genuinely overlap (a river plus one of its
// own gauges), which a hand-built fixture wouldn't reproduce faithfully.
const real = realAliasesJson as Record<string, GaugeAlias>;

describe('river qualified by one of its own gauges (regression)', () => {
  // These used to return NOT_FOUND: tier 3 saw two disagreeing phrases and
  // refused, and tier 4's subset filter was inverted so it never collapsed them.
  // "grand canyon at phantom" is in the real query log — a paddler asked exactly
  // this and got nothing back.
  test.each([
    ['grand canyon at phantom', '09402500'],
    ['grand canyon at diamond creek', '09404200'],
    ['san juan at four corners', '09371010'],
    ['phantom grand canyon', '09402500'],
    ['diamond creek grand canyon', '09404200'],
  ])('%s resolves to the specific gauge', (q, site) => {
    expect(lookupGauge(q, real)?.site).toBe(site);
  });

  test('still resolves when both phrases point at the same gauge', () => {
    expect(lookupGauge('grand canyon at lees ferry', real)?.site).toBe('09380000');
  });

  test('keeps the more specific of two nested phrases', () => {
    expect(lookupGauge('tuolumne grand canyon', real)?.site).toBe('531');
  });

  test('every alias still resolves to its own gauge', () => {
    const broken = Object.keys(real).filter(
      (k) => lookupGauge(k, real)?.site !== real[k]!.site,
    );
    expect(broken).toEqual([]);
  });
});

describe('two rivers in one message are refused, never half-answered', () => {
  // The dangerous case was "stikine, clore": the comma made "stikine"
  // unmatchable, so it answered confidently about Clore alone. Punctuation is
  // now a separator, and a conjunction forces a refusal rather than a guess.
  test.each([
    'grand canyon and phantom',
    'mf salmon and selway',
    'stikine, clore',
    'kings, fantasy falls',
    'selway & main salmon',
    'flows in the grand canyon at lees ferry and phantom',
  ])('refuses %s', (q) => {
    expect(lookupGauge(q, real)).toBeNull();
  });
});

describe('official USGS station names resolve', () => {
  // Paddlers quote gauges the way the agency names them ("what's White Bird
  // reading?"). An audit of all 27 USGS stations against phrasings generated
  // from their official names found 30 that did not resolve and 4 that resolved
  // to the WRONG river.
  test.each([
    ['white bird', '13317000'],
    ['salmon at white bird', '13317000'],
    ['banks', '13246000'],
    ['lowman', '13235000'],
    ['greendale', '09234500'],
    ['west glacier', '12358500'],
    ['columbia falls', '12355500'],
    ['agness', '14372300'],
    ['bluff', '09379500'],
    ['hite', '09328960'],
  ])('%s resolves to its gauge', (q, site) => {
    expect(lookupGauge(q, real)?.site).toBe(site);
  });

  // USGS writes the spaced form ("N F Flathead River nr Columbia Falls MT").
  // Without a contraction for it the fork was lost and the bare "flathead"
  // alias matched -- which is the MIDDLE fork. Wrong river, not a failed lookup.
  test.each([
    ['n f flathead at columbia falls', '12355500'],
    ['s f flathead at twin c', '12359800'],
    ['m f flathead', '12358500'],
  ])('%s keeps its fork', (q, site) => {
    expect(lookupGauge(q, real)?.site).toBe(site);
  });

  // "Grand Canyon" is a run name (Lees Ferry) AND a USGS place name: station
  // 09402500 is literally "COLORADO RIVER NEAR GRAND CANYON, AZ". Qualified,
  // the trailing mention is the gauge.
  test('grand canyon at grand canyon is the Phantom station', () => {
    expect(lookupGauge('grand canyon at grand canyon', real)?.site).toBe('09402500');
  });
  test('bare grand canyon stays Lees Ferry', () => {
    expect(lookupGauge('grand canyon', real)?.site).toBe('09380000');
  });

  // Ambiguity we must keep refusing: there is no "Salmon at Riggins" gauge --
  // 13316500 is the LITTLE Salmon, a much smaller tributary. Answering with it
  // would be a wrong river on a safety call.
  test.each(['salmon at riggins', 'riggins', 'salmon', 'green river'])(
    'refuses ambiguous %s',
    (q) => {
      expect(lookupGauge(q, real)).toBeNull();
    },
  );

  // A conjunction plus two named gauges is a two-river ask even when nesting
  // hides one of them ("grand canyon clore, grand canyon").
  test('refuses a two-river ask that nesting would otherwise hide', () => {
    expect(lookupGauge('grand canyon clore, grand canyon', real)).toBeNull();
  });
});
