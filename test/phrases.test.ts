/**
 * Phrase resolution smoke tests — exercises the full lookup path against real APIs.
 * Covers all three deterministic tiers, normalization, and NOT_FOUND cases.
 *
 * Run:      LIVE=1 npx vitest run test/phrases.test.ts
 * One case: LIVE=1 npx vitest run test/phrases.test.ts -t "stikine"
 */
import { describe, expect, test } from 'vitest';
import { handleQuery, NOT_FOUND } from '../src/handleQuery.js';
import aliases from '../src/aliases.json' with { type: 'json' };
import type { GaugeAlias } from '../src/lookupGauge.js';

declare const process: { env: Record<string, string | undefined> };

const table = aliases as Record<string, GaugeAlias>;
const live = process.env.LIVE ? describe : describe.skip;

// ─── Tier 1: exact alias ─────────────────────────────────────────────────────
live('tier 1 — exact alias', () => {
  test.each([
    // California (Dreamflows)
    ['kings',                   'Kings R (Middle Fork)'],
    ['middle kings',            'Kings R (Middle Fork)'],
    ['fantasy falls',           'Fantasy Falls'],
    ['fantasy',                 'Fantasy Falls'],
    ['nf mokelumne',            'Fantasy Falls'],
    ['royal gorge',             'Royal Gorge'],
    ['postpile',                'Postpile'],
    ['south merced',            'South Fork'],
    ['tuolumne grand canyon',   'Tuolumne R (Grand Canyon)'],
    ['tgc',                     'Tuolumne R (Grand Canyon)'],
    ['tuolumne',                'Tuolumne R'],
    ['upper cherry',            'Cherry Creek (Upper)'],
    ['bald rock',               'Bald Rock'],
    ['devils canyon feather',   'Bald Rock'],
    // Pacific NW (USGS)
    ['rogue',                   'Rogue R'],
    ['deschutes',               'Deschutes R'],
    ['john day',                'John Day R'],
    ['grande ronde',            'Grande Ronde R'],
    ['selway',                  'Selway R'],
    ['hells canyon',            'Snake R (Hells Canyon)'],
    ['snake',                   'Snake R (Hells Canyon)'],
    ['owyhee',                  'Owyhee R'],
    // Idaho salmon (USGS)
    ['main salmon',             'Salmon R (Main)'],
    ['lower salmon',            'Salmon R (Main)'],
    ['river of no return',      'Salmon R (Main)'],
    ['rnr',                     'Salmon R (Main)'],
    ['middle fork salmon',      'Salmon R (Middle Fork)'],
    ['mf salmon',               'Salmon R (Middle Fork)'],
    ['south salmon',            'Salmon R (South Fork)'],
    ['sf salmon',               'Salmon R (South Fork)'],
    // Montana (USGS)
    ['clarks fork',             'Clarks Fork'],
    ['clarks fork box',         'Clarks Fork'],
    ['flathead',                'Flathead R (Middle Fork)'],
    ['mf flathead',             'Flathead R (Middle Fork)'],
    ['nf flathead',             'Flathead R (North Fork)'],
    // Colorado Plateau (USGS)
    ['yampa',                   'Yampa R'],
    ['lodore',                  'Green R'],
    ['gates of lodore',         'Green R'],
    ['deso grey',               'Green R'],
    ['desolation',              'Green R'],
    ['deso',                    'Green R'],
    ['san juan',                'San Juan R'],
    ['cataract',                'Colorado R'],
    ['grand canyon',            'Colorado R'],
    ['lees ferry',              'Colorado R'],
    ['salt',                    'Salt R'],
    ['salt river',              'Salt R'],
    // Alaska (USGS)
    ['susitna',                 'Susitna R'],
    // BC / YT (WSC + NOAA)
    ['stikine',                 'Stikine R'],
    ['iskut',                   'Iskut R'],
    ['alsek',                   'Alsek R'],
    ['tat',                     'Tatshenshini R'],
    ['tatshenshini',            'Tatshenshini R'],
    ['clearwater',              'Clearwater R'],
  ])('"%s" → reply contains "%s"', async (query, nameSubstring) => {
    const reply = await handleQuery(query, { aliases: table });
    console.log(`[${query}] ${reply.split('\n')[0]}`);
    expect(reply).not.toBe(NOT_FOUND);
    expect(reply.length).toBeLessThanOrEqual(160);
    expect(reply).toContain(nameSubstring);
  }, 20_000);
});

// ─── Tier 3 + 4: longer messages / prepositions ──────────────────────────────
live('tier 3+4 — alias embedded or words present in longer message', () => {
  test.each([
    // Alias verbatim inside a longer string
    ['mf salmon at the lodge',          'Salmon R (Middle Fork)'],
    ['what is the stikine',             'Stikine R'],
    ['current level on the deschutes',  'Deschutes R'],
    ['stikine river',                   'Stikine R'],
    ['yampa river',                     'Yampa R'],
    ['grand canyon colorado',           'Colorado R (Grand Canyon)'],
    ['lees ferry az',                   'Colorado R (Grand Canyon)'],
    ['cataract canyon',                 'Colorado R (Cataract)'],
    ['desolation canyon',               'Green R (Desolation)'],
    ['gates of lodore canyon',          'Green R (Gates of Lodore)'],
    ['upper cherry creek',              'Cherry Creek (Upper)'],
    ['hells canyon snake river',        'Snake R (Hells Canyon)'],
    // Prepositions between alias words (word-set tier 4)
    ['middle fork of the salmon',       'Salmon R (Middle Fork)'],
    ['mf of the salmon',                'Salmon R (Middle Fork)'],
    ['gates lodore',                    'Green R (Gates of Lodore)'],
    ['lower salmon river id',           'Salmon R (Main)'],
    ['main salmon river',               'Salmon R (Main)'],
    ['sf salmon river',                 'Salmon R (South Fork)'],
    ['grande ronde river',              'Grande Ronde R'],
    // Normalization
    ['MF SALMON',                       'Salmon R (Middle Fork)'],
    ['GRAND CANYON',                    'Colorado R (Grand Canyon)'],
    ['mf  salmon',                      'Salmon R (Middle Fork)'],
    ['  stikine  ',                     'Stikine R'],
  ])('"%s" → reply contains "%s"', async (query, nameSubstring) => {
    const reply = await handleQuery(query, { aliases: table });
    console.log(`[${query}] ${reply.split('\n')[0]}`);
    expect(reply).not.toBe(NOT_FOUND);
    expect(reply.length).toBeLessThanOrEqual(160);
    expect(reply).toContain(nameSubstring);
  }, 20_000);
});

// ─── Tier 2: raw gauge ID ─────────────────────────────────────────────────────
live('tier 2 — raw ID lookup', () => {
  test.each([
    ['13309220',  'USGS 13309220'],   // MF Salmon
    ['09380000',  'USGS 09380000'],   // Grand Canyon
    ['14103000',  'USGS 14103000'],   // Deschutes
    ['08CE001',   'WSC 08CE001'],     // Stikine
    ['08AB001',   'WSC 08AB001'],     // Alsek
  ])('"%s" → reply contains "%s"', async (id, idLabel) => {
    const reply = await handleQuery(id, { aliases: table });
    console.log(`[${id}] ${reply.split('\n')[0]}`);
    expect(reply).not.toBe(NOT_FOUND);
    expect(reply.length).toBeLessThanOrEqual(160);
    expect(reply).toContain(idLabel);
  }, 20_000);
});

// ─── NOT_FOUND cases (no network needed, run always) ─────────────────────────
describe('not-found cases', () => {
  test.each([
    [''],
    ['   '],
    ['gauley'],           // real river, not in the system
    ['gauley summersville'],
    ['new river'],
    ['salmon'],           // ambiguous — four salmon gauges, no single match
    ['salmon river'],
    ['mystery creek'],
    ['hello'],
    ['12345'],            // too short for USGS ID
    ['1234567'],          // one digit short
  ])('"%s" → NOT_FOUND', async (query) => {
    const reply = await handleQuery(query, { aliases: table });
    expect(reply).toBe(NOT_FOUND);
  });
});
