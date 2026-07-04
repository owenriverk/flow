/**
 * Guards the duplicated gauge metadata: src/aliases.json (bot replies) and
 * supabase/functions/refresh-gauges/gauges.ts (website) both carry name/location
 * per gauge, hand-edited in parallel. Set membership is asserted both ways —
 * NOT a site→single-entry map, because a source:site can legitimately host two
 * named runs (Tuolumne pair on dreamflows:531, Cherry pair on dreamflows:665).
 */
import { describe, expect, it } from 'vitest';
import aliasesJson from '../src/aliases.json' with { type: 'json' };
import { GAUGES } from '../supabase/functions/refresh-gauges/gauges';
import type { GaugeAlias } from '../src/lookupGauge.js';

const aliases = aliasesJson as Record<string, GaugeAlias>;

const pair = (source: string | undefined, site: string) => `${source ?? 'usgs'}:${site}`;

describe('aliases.json ↔ gauges.ts name consistency', () => {
  it('every alias (source:site, name, location) appears among the gauges.ts entries for that site', () => {
    const gaugeTriples = new Set(GAUGES.map((g) => `${pair(g.source, g.site)}|${g.name}|${g.location}`));
    const strays = Object.entries(aliases)
      .filter(([, a]) => !gaugeTriples.has(`${pair(a.source, a.site)}|${a.name}|${a.location}`))
      .map(([key, a]) => `${key} → ${pair(a.source, a.site)} "${a.name}", "${a.location}"`);
    expect(strays).toEqual([]);
  });

  it('every gauges.ts (source:site, name) is carried by at least one alias row', () => {
    const aliasPairs = new Set(Object.values(aliases).map((a) => `${pair(a.source, a.site)}|${a.name}`));
    const orphans = GAUGES.filter((g) => !aliasPairs.has(`${pair(g.source, g.site)}|${g.name}`)).map(
      (g) => `${g.key} → ${pair(g.source, g.site)} "${g.name}"`,
    );
    expect(orphans).toEqual([]);
  });

  it('every gauges.ts text_key is a real alias key resolving to the same gauge', () => {
    for (const g of GAUGES) {
      const a = aliases[g.text_key];
      expect(a, `text_key "${g.text_key}" (${g.key}) missing from aliases.json`).toBeDefined();
      expect(pair(a!.source, a!.site), `text_key "${g.text_key}" points at a different gauge`).toBe(
        pair(g.source, g.site),
      );
    }
  });
});
