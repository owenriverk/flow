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
    ['kings',                    'Middle Kings'],
    ['middle kings',             'Middle Kings'],
    ['mk',                       'Middle Kings'],
    ['fantasy falls',            'Fantasy Falls (NF Mokelumne)'],
    ['fantasy',                  'Fantasy Falls (NF Mokelumne)'],
    ['ff',                       'Fantasy Falls (NF Mokelumne)'],
    ['nf mokelumne',             'Fantasy Falls (NF Mokelumne)'],
    ['nf moke',                  'Fantasy Falls (NF Mokelumne)'],
    ['the moke',                 'Fantasy Falls (NF Mokelumne)'],
    ['royal gorge',              'Royal Gorge (NF American)'],
    ['royal',                    'Royal Gorge (NF American)'],
    ['nf american',              'Royal Gorge (NF American)'],
    ['postpile',                 'Devils Postpile (San Joaquin)'],
    ['devils postpile',          'Devils Postpile (San Joaquin)'],
    ['sj',                       'Devils Postpile (San Joaquin)'],
    ['san joaquin',              'Devils Postpile (San Joaquin)'],
    ['south merced',             'South Fork Merced'],
    ['s merced',                 'South Fork Merced'],
    ['sf merced',                'South Fork Merced'],
    ['tuolumne grand canyon',    'Grand Canyon of the Tuolumne'],
    ['tgc',                      'Grand Canyon of the Tuolumne'],
    ['gc t',                     'Grand Canyon of the Tuolumne'],
    ['tuolumne gc',              'Grand Canyon of the Tuolumne'],
    ['tuolumne',                 'Tuolumne (Main)'],
    ['main t',                   'Tuolumne (Main)'],
    ['the t',                    'Tuolumne (Main)'],
    ['upper cherry',             'Upper Cherry Creek'],
    ['uc',                       'Upper Cherry Creek'],
    ['west cherry',              'West Cherry Creek'],
    ['west cherry creek',        'West Cherry Creek'],
    ['bald rock',                'Bald Rock (MF Feather)'],
    ['devils canyon feather',    'Bald Rock (MF Feather)'],
    ['mf feather',               'Bald Rock (MF Feather)'],
    ['devils',                   'Bald Rock (MF Feather)'],
    ['the feather',              'Bald Rock (MF Feather)'],
    // Pacific NW (USGS)
    ['rogue',                   'Rogue R'],
    ['deschutes',               'Deschutes R'],
    ['deschy',                  'Deschutes R'],
    ['john day',                'John Day R'],
    ['jd',                      'John Day R'],
    ['grande ronde',            'Grande Ronde R'],
    ['ronde',                   'Grande Ronde R'],
    ['the ronde',               'Grande Ronde R'],
    ['selway',                  'Selway R'],
    ['hells canyon',             'Hells Canyon (Snake R)'],
    ['snake',                    'Hells Canyon (Snake R)'],
    ['hells',                    'Hells Canyon (Snake R)'],
    ['hc',                       'Hells Canyon (Snake R)'],
    ['owyhee',                  'Owyhee R'],
    // Idaho salmon (USGS)
    ['main salmon',              'Main Salmon'],
    ['lower salmon',             'Main Salmon'],
    ['river of no return',       'Main Salmon'],
    ['rnr',                      'Main Salmon'],
    ['middle fork salmon',       'Middle Fork Salmon'],
    ['mf salmon',                'Middle Fork Salmon'],
    ['mfs',                      'Middle Fork Salmon'],
    ['the middle fork',          'Middle Fork Salmon'],
    ['south salmon',             'South Fork Salmon'],
    ['sf salmon',                'South Fork Salmon'],
    ['sfs',                      'South Fork Salmon'],
    // Montana (USGS)
    ['clarks fork',              'Clarks Fork (the Box)'],
    ['clarks fork box',          'Clarks Fork (the Box)'],
    ['the box',                  'Clarks Fork (the Box)'],
    ['clarks',                   'Clarks Fork (the Box)'],
    ['flathead',                 'Middle Fork Flathead'],
    ['mf flathead',              'Middle Fork Flathead'],
    ['middle flathead',          'Middle Fork Flathead'],
    ['nf flathead',              'North Fork Flathead'],
    ['north flathead',           'North Fork Flathead'],
    // Colorado Plateau (USGS)
    ['yampa',                   'Yampa R'],
    ['lodore',                   'Gates of Lodore (Green R)'],
    ['gates of lodore',          'Gates of Lodore (Green R)'],
    ['gates',                    'Gates of Lodore (Green R)'],
    ['deso grey',                'Desolation (Green R)'],
    ['desolation',               'Desolation (Green R)'],
    ['deso',                     'Desolation (Green R)'],
    ['san juan',                'San Juan R'],
    ['the juan',                'San Juan R'],
    ['cataract',                 'Cataract Canyon (Colorado R)'],
    ['cat',                      'Cataract Canyon (Colorado R)'],
    ['grand canyon',             'Grand Canyon (Colorado R)'],
    ['lees ferry',               'Grand Canyon (Colorado R)'],
    ['gc',                       'Grand Canyon (Colorado R)'],
    ['the ditch',                'Grand Canyon (Colorado R)'],
    ['phantom',                  'Grand Canyon — Phantom (Colorado R)'],
    ['phantom ranch',            'Grand Canyon — Phantom (Colorado R)'],
    ['salt',                    'Salt R'],
    ['salt river',              'Salt R'],
    // Alaska (USGS)
    ['susitna',                  'Susitna (Devils Canyon)'],
    ['the su',                   'Susitna (Devils Canyon)'],
    // BC / YT (WSC + NOAA)
    ['stikine',                  'Stikine (Grand Canyon)'],
    ['gc stikine',               'Stikine (Grand Canyon)'],
    ['iskut',                   'Iskut R'],
    ['alsek',                   'Alsek R'],
    ['tat',                     'Tatshenshini R'],
    ['tatshenshini',            'Tatshenshini R'],
    ['clore',                    'Clore (Zymoetz R)'],
    ['gc clore',                 'Clore (Zymoetz R)'],
    ['copper',                   'Clore (Zymoetz R)'],
    ['copper river',             'Clore (Zymoetz R)'],
    ['zymoetz',                  'Clore (Zymoetz R)'],
    ['calor',                    'Clore (Zymoetz R)'],
    ['clearwater',              'Clearwater R'],
    ['bc clearwater',           'Clearwater R'],
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
    ['mf salmon at the lodge',   'Middle Fork Salmon'],
    ['what is the stikine',      'Stikine (Grand Canyon)'],
    ['current level on the deschutes',  'Deschutes R'],
    ['stikine river',            'Stikine (Grand Canyon)'],
    ['yampa river',                     'Yampa R'],
    ['grand canyon colorado',    'Grand Canyon (Colorado R)'],
    ['lees ferry az',            'Grand Canyon (Colorado R)'],
    ['cataract canyon',          'Cataract Canyon (Colorado R)'],
    ['desolation canyon',        'Desolation (Green R)'],
    ['gates of lodore canyon',   'Gates of Lodore (Green R)'],
    ['upper cherry creek',       'Upper Cherry Creek'],
    ['west cherry creek at the put in','West Cherry Creek'],
    ['hells canyon snake river', 'Hells Canyon (Snake R)'],
    // Prepositions between alias words (word-set tier 4)
    ['middle fork of the salmon','Middle Fork Salmon'],
    ['mf of the salmon',         'Middle Fork Salmon'],
    ['gates lodore',             'Gates of Lodore (Green R)'],
    ['lower salmon river id',    'Main Salmon'],
    ['main salmon river',        'Main Salmon'],
    ['sf salmon river',          'South Fork Salmon'],
    ['grande ronde river',              'Grande Ronde R'],
    // Normalization
    ['MF SALMON',                'Middle Fork Salmon'],
    ['GRAND CANYON',             'Grand Canyon (Colorado R)'],
    ['mf  salmon',               'Middle Fork Salmon'],
    ['  stikine  ',              'Stikine (Grand Canyon)'],
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
