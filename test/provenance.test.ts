/**
 * Provenance ratchet — the enforcement mechanism behind the 35-gauge audit.
 *
 * INVERTED ratchet: we bound the number of gauges that may lack a provenance
 * entry, and only ever lower the bound. Counting down (instead of counting
 * audited gauges up) means a NEW gauge added without provenance fails
 * immediately at any stage of the audit — including long after it completes,
 * when MAX_UNAUDITED is 0 and this test is a hard gate.
 *
 * Owner workflow: audit a gauge -> add its entry to src/provenance.json ->
 * lower MAX_UNAUDITED to the new unaudited count printed below. The bound can
 * never go back up; deleting an entry or adding an unaudited gauge fails.
 */

import { describe, expect, it } from 'vitest';
import aliasesJson from '../src/aliases.json' with { type: 'json' };
import provenanceJson from '../src/provenance.json' with { type: 'json' };
import type { GaugeAlias } from '../src/lookupGauge.js';

// Lower this as the audit progresses. Never raise it.
const MAX_UNAUDITED = 35;

const aliases = aliasesJson as Record<string, GaugeAlias>;
const provenance = provenanceJson as unknown as {
  gauges: Record<string, { verifiedBy: string; verifiedOn: string; source: string; notes: string }>;
  rituals: Array<{ date: string; device: string; result: string; notes?: string }>;
};

const gaugeKey = (a: GaugeAlias) => `${a.source ?? 'usgs'}:${a.site}`;
const currentPairs = new Set(Object.values(aliases).map(gaugeKey));

describe('gauge provenance', () => {
  it(`at most ${MAX_UNAUDITED} gauges may lack a provenance entry (inverted ratchet)`, () => {
    const unaudited = [...currentPairs].filter((pair) => !(pair in provenance.gauges)).sort();
    if (unaudited.length > 0) {
      console.warn(
        `provenance audit remaining (${unaudited.length}/${currentPairs.size}):\n  ` +
          unaudited.join('\n  '),
      );
    }
    expect(unaudited.length).toBeLessThanOrEqual(MAX_UNAUDITED);
  });

  it('every provenance entry refers to a gauge that still exists in aliases.json', () => {
    const orphans = Object.keys(provenance.gauges).filter((key) => !currentPairs.has(key));
    expect(orphans).toEqual([]);
  });

  it('every provenance entry is complete and internally consistent', () => {
    for (const [key, entry] of Object.entries(provenance.gauges)) {
      expect(entry.verifiedBy, `${key} verifiedBy`).toMatch(/\S/);
      expect(entry.verifiedOn, `${key} verifiedOn`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(entry.verifiedOn)), `${key} verifiedOn parses`).toBe(false);
      expect(`${entry.source}:`, `${key} source matches key`).toBe(key.slice(0, key.indexOf(':') + 1));
      expect(entry.notes, `${key} notes`).toMatch(/\S/);
    }
  });

  it('ritual entries are dated real-device results', () => {
    for (const ritual of provenance.rituals) {
      expect(ritual.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(ritual.device).toMatch(/\S/);
      expect(['delivered', 'failed']).toContain(ritual.result);
    }
  });
});
