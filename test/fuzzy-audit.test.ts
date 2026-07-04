/**
 * Documents resolution coverage across tiers. Run: npx vitest run test/fuzzy-audit.test.ts
 * "AI-only" cases pass regardless (they're documentation, not assertions).
 */
import { describe, expect, test } from 'vitest';
import { lookupGauge } from '../src/lookupGauge.js';
import aliases from '../src/aliases.json' with { type: 'json' };
import type { GaugeAlias } from '../src/lookupGauge.js';

const table = aliases as Record<string, GaugeAlias>;

function resolve(text: string) {
  const r = lookupGauge(text, table);
  return r ? ('name' in r ? r.name : r.site) : null;
}

describe('deterministic — must resolve without AI', () => {
  test.each([
    // ── Exact alias ────────────────────────────────────────────────
    ['mf salmon',                     'Middle Fork Salmon'],
    ['grand canyon',                  'Grand Canyon (Colorado R)'],
    ['stikine',                       'Stikine (Grand Canyon)'],
    ['desolation',                    'Desolation (Green R)'],
    ['deso grey',                     'Desolation (Green R)'],
    ['deso',                          'Desolation (Green R)'],
    ['gates of lodore',               'Gates of Lodore (Green R)'],
    ['west cherry',                   'West Cherry Creek'],
    ['west cherry creek',             'West Cherry Creek'],
    ['west cherry creek flow',        'West Cherry Creek'],

    // ── Tier 3: alias verbatim inside longer message ───────────────
    // "river" suffix
    ['stikine river',                 'Stikine (Grand Canyon)'],
    ['yampa river',                   'Yampa R'],
    ['rogue river',                   'Rogue R'],
    ['selway river',                  'Selway R'],
    ['deschutes river',               'Deschutes R'],
    ['san juan river',                'San Juan R'],
    ['salt river levels',             'Salt R'],
    // location context appended
    ['grand canyon colorado',         'Grand Canyon (Colorado R)'],
    ['lees ferry az',                 'Grand Canyon (Colorado R)'],
    ['mf salmon at the lodge',        'Middle Fork Salmon'],
    ['main salmon white bird',        'Main Salmon'],
    ['tuolumne grand canyon flows',   'Grand Canyon of the Tuolumne'],
    // canyon / lake / falls suffixes
    ['cataract canyon',               'Cataract Canyon (Colorado R)'],
    ['desolation canyon',             'Desolation (Green R)'],
    ['fantasy falls ca',              'Fantasy Falls (NF Mokelumne)'],
    // Caps + whitespace normalisation
    ['MF SALMON',                     'Middle Fork Salmon'],
    ['GRAND CANYON',                  'Grand Canyon (Colorado R)'],
    ['  stikine  ',                   'Stikine (Grand Canyon)'],
    ['mf  salmon',                    'Middle Fork Salmon'],

    // ── Tier 4: word-set (prepositions / filler in between) ────────
    ['middle fork of the salmon',     'Middle Fork Salmon'],
    ['mf of the salmon',              'Middle Fork Salmon'],
    ['middle fork salmon river',      'Middle Fork Salmon'],
    ['gates lodore',                  'Gates of Lodore (Green R)'],   // "of" stripped from alias
    ['lower salmon river id',         'Main Salmon'],
    ['main salmon river',             'Main Salmon'],
    ['sf salmon river',               'South Fork Salmon'],
    ['south salmon river',            'South Fork Salmon'],
    ['hells canyon snake river',      'Hells Canyon (Snake R)'],
    ['grande ronde river',            'Grande Ronde R'],
    ['john day river',                'John Day R'],
    ['clarks fork box canyon',        'Clarks Fork (the Box)'],
    ['upper cherry creek',            'Upper Cherry Creek'],
    ['tuolumne grand canyon section', 'Grand Canyon of the Tuolumne'],
    ['san joaquin river',             'Devils Postpile (San Joaquin)'],
    ['copper river bc',               'Clore (Zymoetz R)'],          // zymoetz word-set

    // ── Tier 5: fork contraction ("north fork X" → "nf X") ────────
    ['north fork flathead',           'North Fork Flathead'],
    ['north fork american river',     'Royal Gorge (NF American)'],
    ['south fork salmon river',       'South Fork Salmon'],
    ['middle fork feather',           'Bald Rock (MF Feather)'],
    ['middle fork of the flathead',   'Middle Fork Flathead'],
  ])('"%s" → %s', (input, name) => {
    expect(resolve(input)).toBe(name);
  });
});

describe('AI-only cases — document what still needs the fuzzy tier', () => {
  test.each([
    // Typos — no deterministic path
    'stikeen',            // stikine
    'deschuttes',         // deschutes
    'yampa colo',         // yampa (extra word not in alias)
    // Slang / local names
    'river of no return',  // now an alias → det resolves it
    // Ambiguous without context
    'green river',        // two green gauges — AI should pick desolation/lodore
    'salmon',             // four salmon gauges
  ])('"%s" → needs AI tier', (input) => {
    const result = resolve(input);
    console.log(result ? `  [det resolved] ${input} → ${result}` : `  [AI needed]   ${input}`);
    expect(true).toBe(true);
  });
});

// Real production incident (2026-06-30): "stikine rivr grand canyon" resolved
// deterministically to Colorado R (Grand Canyon) instead of the Stikine, because
// "grand canyon" (12 chars) is textually longer than "stikine" (7 chars) and the old
// tier-3 matcher just picked whichever candidate string was longest. "grand canyon" is
// also part of several other rivers' full names in this table (Tuolumne, Zymoetz) —
// these assert the deterministic tiers refuse to guess rather than silently returning
// an unrelated gauge; the caller falls through to the AI tier or NOT_FOUND instead.
describe('ambiguous queries — must refuse to guess, never return the wrong gauge', () => {
  test.each([
    'stikine grand canyon',
    'stikine rivr grand canyon',
    'zymoetz grand canyon',
    'copper river grand canyon',
  ])('"%s" → null (not silently resolved to Colorado)', (input) => {
    expect(resolve(input)).toBeNull();
  });

  test('sanity: "grand canyon" alone is unaffected and still resolves to Colorado', () => {
    expect(resolve('grand canyon')).toBe('Grand Canyon (Colorado R)');
  });

  test('sanity: a nested match ("grand canyon" inside a longer known alias) still resolves', () => {
    expect(resolve('tuolumne grand canyon flows')).toBe('Grand Canyon of the Tuolumne');
  });
});
