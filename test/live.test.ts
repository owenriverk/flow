/**
 * Live end-to-end smoke test against the real USGS / WSC / CDEC APIs.
 * Off by default (network-dependent). Run with: LIVE=1 npx vitest run test/live.test.ts
 */
import { describe, expect, test } from 'vitest';
import { handleQuery, NOT_FOUND } from '../src/handleQuery.js';
import aliases from '../src/aliases.json' with { type: 'json' };
import type { GaugeAlias } from '../src/lookupGauge.js';

declare const process: { env: Record<string, string | undefined> };

const table = aliases as Record<string, GaugeAlias>;
const live = process.env.LIVE ? describe : describe.skip;

live('live gauge queries', () => {
  test.each([
    ['main salmon', 'USGS'],
    ['south salmon', 'USGS'],
    ['deschutes', 'USGS'],
    ['salt', 'USGS'],
    ['stikine', 'WSC'],
    ['fantasy falls', 'CDEC'],
    ['kings', 'CDEC'],
    ['west cherry', 'CDEC'],
  ])('%s returns a <=160 reply labeled %s', async (query, label) => {
    const reply = await handleQuery(query, { aliases: table });
    console.log(`\n[${query}]\n${reply}`);
    expect(reply.length).toBeLessThanOrEqual(160);
    expect(reply).toContain(label);
    expect(reply).not.toBe(NOT_FOUND);
  }, 20000);

  test('an unknown run replies NOT_FOUND', async () => {
    expect(await handleQuery('mystery creek', { aliases: table })).toBe(NOT_FOUND);
  });
});
