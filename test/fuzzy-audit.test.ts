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
    ['mf salmon',                     'Salmon R (Middle Fork)'],
    ['grand canyon',                  'Colorado R (Grand Canyon)'],
    ['stikine',                       'Stikine R'],
    ['desolation',                    'Green R (Desolation)'],
    ['deso grey',                     'Green R (Desolation)'],
    ['deso',                          'Green R (Desolation)'],
    ['gates of lodore',               'Green R (Gates of Lodore)'],

    // ── Tier 3: alias verbatim inside longer message ───────────────
    // "river" suffix
    ['stikine river',                 'Stikine R'],
    ['yampa river',                   'Yampa R'],
    ['rogue river',                   'Rogue R'],
    ['selway river',                  'Selway R'],
    ['deschutes river',               'Deschutes R'],
    ['san juan river',                'San Juan R'],
    ['salt river levels',             'Salt R'],
    // location context appended
    ['grand canyon colorado',         'Colorado R (Grand Canyon)'],
    ['lees ferry az',                 'Colorado R (Grand Canyon)'],
    ['mf salmon at the lodge',        'Salmon R (Middle Fork)'],
    ['main salmon white bird',        'Salmon R (Main)'],
    ['tuolumne grand canyon flows',   'Tuolumne R (Grand Canyon)'],
    // canyon / lake / falls suffixes
    ['cataract canyon',               'Colorado R (Cataract)'],
    ['desolation canyon',             'Green R (Desolation)'],
    ['fantasy falls ca',              'NF Mokelumne R (Fantasy Falls)'],
    // Caps + whitespace normalisation
    ['MF SALMON',                     'Salmon R (Middle Fork)'],
    ['GRAND CANYON',                  'Colorado R (Grand Canyon)'],
    ['  stikine  ',                   'Stikine R'],
    ['mf  salmon',                    'Salmon R (Middle Fork)'],

    // ── Tier 4: word-set (prepositions / filler in between) ────────
    ['middle fork of the salmon',     'Salmon R (Middle Fork)'],
    ['mf of the salmon',              'Salmon R (Middle Fork)'],
    ['middle fork salmon river',      'Salmon R (Middle Fork)'],
    ['gates lodore',                  'Green R (Gates of Lodore)'],   // "of" stripped from alias
    ['lower salmon river id',         'Salmon R (Main)'],
    ['main salmon river',             'Salmon R (Main)'],
    ['sf salmon river',               'Salmon R (South Fork)'],
    ['south salmon river',            'Salmon R (South Fork)'],
    ['hells canyon snake river',      'Snake R (Hells Canyon)'],
    ['grande ronde river',            'Grande Ronde R'],
    ['john day river',                'John Day R'],
    ['clarks fork box canyon',        'Clarks Fork'],
    ['upper cherry creek',            'Cherry Creek (Upper)'],
    ['tuolumne grand canyon section', 'Tuolumne R (Grand Canyon)'],
    ['san joaquin river',             'San Joaquin R (Postpile)'],
    ['copper river bc',               'Zymoetz R (Copper)'],          // zymoetz word-set

    // ── Tier 5: fork contraction ("north fork X" → "nf X") ────────
    ['north fork flathead',           'Flathead R (North Fork)'],
    ['north fork american river',     'N Fork American R (Royal Gorge)'],
    ['south fork salmon river',       'Salmon R (South Fork)'],
    ['middle fork feather',           'Feather R (Bald Rock)'],
    ['middle fork of the flathead',   'Flathead R (Middle Fork)'],
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
    expect(resolve('grand canyon')).toBe('Colorado R (Grand Canyon)');
  });

  test('sanity: a nested match ("grand canyon" inside a longer known alias) still resolves', () => {
    expect(resolve('tuolumne grand canyon flows')).toBe('Tuolumne R (Grand Canyon)');
  });
});
