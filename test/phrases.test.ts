/**
 * Phrase resolution smoke tests — exercises the full lookup path against real APIs.
 * Covers all three deterministic tiers, normalization, and NOT_FOUND cases.
 *
 * Run:      LIVE=1 npx vitest run test/phrases.test.ts
 * One case: LIVE=1 npx vitest run test/phrases.test.ts -t "stikine"
 */
import { describe, expect, test } from 'vitest';
import { handleQuery, NOT_FOUND } from '../src/handleQuery.js';
import { replySafe } from '../src/formatReply.js';
import aliases from '../src/aliases.json' with { type: 'json' };
import type { GaugeAlias } from '../src/lookupGauge.js';

declare const process: { env: Record<string, string | undefined> };

const table = aliases as Record<string, GaugeAlias>;
const live = process.env.LIVE ? describe : describe.skip;

// ─── Tier 1: exact alias ─────────────────────────────────────────────────────
live('tier 1 — exact alias', () => {
  test.each([
    // California (Dreamflows)
    ['kings',                    'Kings / Middle Fork'],
    ['middle kings',             'Kings / Middle Fork'],
    ['mk',                       'Kings / Middle Fork'],
    ['fantasy falls',            'Mokelumne / North Fork — Fantasy Falls'],
    ['fantasy',                  'Mokelumne / North Fork — Fantasy Falls'],
    ['ff',                       'Mokelumne / North Fork — Fantasy Falls'],
    ['nf mokelumne',             'Mokelumne / North Fork — Fantasy Falls'],
    ['nf moke',                  'Mokelumne / North Fork — Fantasy Falls'],
    ['the moke',                 'Mokelumne / North Fork — Fantasy Falls'],
    ['royal gorge',              'American / North Fork — Royal Gorge'],
    ['royal',                    'American / North Fork — Royal Gorge'],
    ['nf american',              'American / North Fork — Royal Gorge'],
    ['postpile',                 'San Joaquin / Devils Postpile'],
    ['devils postpile',          'San Joaquin / Devils Postpile'],
    ['sj',                       'San Joaquin / Devils Postpile'],
    ['san joaquin',              'San Joaquin / Devils Postpile'],
    ['south merced',             'Merced / South Fork'],
    ['s merced',                 'Merced / South Fork'],
    ['sf merced',                'Merced / South Fork'],
    ['tuolumne grand canyon',    'Tuolumne / Grand Canyon'],
    ['tgc',                      'Tuolumne / Grand Canyon'],
    ['gc t',                     'Tuolumne / Grand Canyon'],
    ['tuolumne gc',              'Tuolumne / Grand Canyon'],
    ['tuolumne',                 'Tuolumne / Main'],
    ['main t',                   'Tuolumne / Main'],
    ['the t',                    'Tuolumne / Main'],
    ['upper cherry',             'Cherry Creek / Upper'],
    ['uc',                       'Cherry Creek / Upper'],
    ['west cherry',              'Cherry Creek / West'],
    ['west cherry creek',        'Cherry Creek / West'],
    ['bald rock',                'Feather / Middle Fork — Bald Rock'],
    ['devils canyon feather',    'Feather / Middle Fork — Bald Rock'],
    ['mf feather',               'Feather / Middle Fork — Bald Rock'],
    ['devils',                   'Feather / Middle Fork — Bald Rock'],
    ['the feather',              'Feather / Middle Fork — Bald Rock'],
    // Pacific NW (USGS)
    ['rogue',                   'Rogue'],
    ['deschutes',               'Deschutes'],
    ['deschy',                  'Deschutes'],
    ['john day',                'John Day'],
    ['jd',                      'John Day'],
    ['grande ronde',            'Grande Ronde'],
    ['ronde',                   'Grande Ronde'],
    ['the ronde',               'Grande Ronde'],
    ['selway',                  'Selway'],
    ['hells canyon',             'Snake / Hells Canyon'],
    ['snake',                    'Snake / Hells Canyon'],
    ['hells',                    'Snake / Hells Canyon'],
    ['hc',                       'Snake / Hells Canyon'],
    ['owyhee',                  'Owyhee'],
    // Idaho salmon (USGS)
    ['main salmon',              'Salmon / Main'],
    ['lower salmon',             'Salmon / Main'],
    ['river of no return',       'Salmon / Main'],
    ['rnr',                      'Salmon / Main'],
    ['middle fork salmon',       'Salmon / Middle Fork'],
    ['mf salmon',                'Salmon / Middle Fork'],
    ['mfs',                      'Salmon / Middle Fork'],
    ['the middle fork',          'Salmon / Middle Fork'],
    ['south salmon',             'Salmon / South Fork'],
    ['sf salmon',                'Salmon / South Fork'],
    ['sfs',                      'Salmon / South Fork'],
    // Montana (USGS)
    ['clarks fork',              'Clarks Fork / the Box'],
    ['clarks fork box',          'Clarks Fork / the Box'],
    ['the box',                  'Clarks Fork / the Box'],
    ['clarks',                   'Clarks Fork / the Box'],
    ['flathead',                 'Flathead / Middle Fork'],
    ['mf flathead',              'Flathead / Middle Fork'],
    ['middle flathead',          'Flathead / Middle Fork'],
    ['nf flathead',              'Flathead / North Fork'],
    ['north flathead',           'Flathead / North Fork'],
    // Colorado Plateau (USGS)
    ['yampa',                   'Yampa'],
    ['lodore',                   'Green / Gates of Lodore'],
    ['gates of lodore',          'Green / Gates of Lodore'],
    ['gates',                    'Green / Gates of Lodore'],
    ['deso grey',                'Green / Desolation'],
    ['desolation',               'Green / Desolation'],
    ['deso',                     'Green / Desolation'],
    ['san juan',                'San Juan'],
    ['four corners',             'San Juan / Four Corners'],
    ['4 corners',                'San Juan / Four Corners'],
    ['san juan four corners',    'San Juan / Four Corners'],
    ['the juan',                'San Juan'],
    ['cataract',                 'Colorado / Cataract Canyon'],
    ['cat',                      'Colorado / Cataract Canyon'],
    ['grand canyon',             'Colorado / Grand Canyon'],
    ['lees ferry',               'Colorado / Grand Canyon'],
    ['gc',                       'Colorado / Grand Canyon'],
    ['the ditch',                'Colorado / Grand Canyon'],
    ['phantom',                  'Colorado / Grand Canyon — Phantom'],
    ['phantom ranch',            'Colorado / Grand Canyon — Phantom'],
    ['diamond',                  'Colorado / Grand Canyon — Diamond'],
    ['diamond creek',            'Colorado / Grand Canyon — Diamond'],
    ['grand canyon diamond',     'Colorado / Grand Canyon — Diamond'],
    ['salt',                    'Salt'],
    ['salt river',              'Salt'],
    // Alaska (USGS)
    ['susitna',                  'Susitna / Devils Canyon'],
    ['the su',                   'Susitna / Devils Canyon'],
    // BC / YT (WSC + NOAA)
    ['stikine',                  'Stikine / Grand Canyon'],
    ['gc stikine',               'Stikine / Grand Canyon'],
    ['iskut',                   'Iskut'],
    ['alsek',                   'Alsek'],
    ['tat',                     'Tatshenshini'],
    ['tatshenshini',            'Tatshenshini'],
    ['clore',                    'Zymoetz / Clore'],
    ['gc clore',                 'Zymoetz / Clore'],
    ['copper',                   'Zymoetz / Clore'],
    ['copper river',             'Zymoetz / Clore'],
    ['zymoetz',                  'Zymoetz / Clore'],
    ['clearwater',              'Clearwater'],
    ['bc clearwater',           'Clearwater'],
    ['homathko',                'Homathko'],
    ['homathko river',          'Homathko'],
  ])('"%s" → reply contains "%s"', async (query, nameSubstring) => {
    const reply = await handleQuery(query, { aliases: table });
    console.log(`[${query}] ${reply.split('\n')[0]}`);
    expect(reply).not.toBe(NOT_FOUND);
    expect(reply.length).toBeLessThanOrEqual(160);
    expect(reply).toContain(replySafe(nameSubstring));
  }, 20_000);
});

// ─── Tier 3 + 4: longer messages / prepositions ──────────────────────────────
live('tier 3+4 — alias embedded or words present in longer message', () => {
  test.each([
    // Alias verbatim inside a longer string
    ['mf salmon at the lodge',   'Salmon / Middle Fork'],
    ['what is the stikine',      'Stikine / Grand Canyon'],
    ['current level on the deschutes',  'Deschutes'],
    ['stikine river',            'Stikine / Grand Canyon'],
    ['yampa river',                     'Yampa'],
    ['grand canyon colorado',    'Colorado / Grand Canyon'],
    ['lees ferry az',            'Colorado / Grand Canyon'],
    ['cataract canyon',          'Colorado / Cataract Canyon'],
    ['desolation canyon',        'Green / Desolation'],
    ['gates of lodore canyon',   'Green / Gates of Lodore'],
    ['upper cherry creek',       'Cherry Creek / Upper'],
    ['west cherry creek at the put in','Cherry Creek / West'],
    ['hells canyon snake river', 'Snake / Hells Canyon'],
    // Prepositions between alias words (word-set tier 4)
    ['middle fork of the salmon','Salmon / Middle Fork'],
    ['mf of the salmon',         'Salmon / Middle Fork'],
    ['gates lodore',             'Green / Gates of Lodore'],
    ['lower salmon river id',    'Salmon / Main'],
    ['main salmon river',        'Salmon / Main'],
    ['sf salmon river',          'Salmon / South Fork'],
    ['grande ronde river',              'Grande Ronde'],
    // Normalization
    ['MF SALMON',                'Salmon / Middle Fork'],
    ['GRAND CANYON',             'Colorado / Grand Canyon'],
    ['mf  salmon',               'Salmon / Middle Fork'],
    ['  stikine  ',              'Stikine / Grand Canyon'],
  ])('"%s" → reply contains "%s"', async (query, nameSubstring) => {
    const reply = await handleQuery(query, { aliases: table });
    console.log(`[${query}] ${reply.split('\n')[0]}`);
    expect(reply).not.toBe(NOT_FOUND);
    expect(reply.length).toBeLessThanOrEqual(160);
    expect(reply).toContain(replySafe(nameSubstring));
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
