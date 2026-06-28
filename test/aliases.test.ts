import { describe, expect, test } from 'vitest';
import aliases from '../src/aliases.json' with { type: 'json' };
import { lookupGauge, type GaugeAlias, type GaugeRef } from '../src/lookupGauge.js';

const table = aliases as Record<string, GaugeAlias>;

const USGS_ID = /^\d{8,15}$/;
const WSC_ID = /^\d{2}[A-Z]{2}\d{3}$/;
const CDEC_ID = /^[A-Z0-9]{3}$/;

describe('aliases.json', () => {
  test('every entry has a name, a location, and a valid id for its source', () => {
    for (const [key, entry] of Object.entries(table)) {
      expect(entry.name?.length, `${key} name`).toBeGreaterThan(0);
      expect(entry.location?.length, `${key} location`).toBeGreaterThan(0);
      if (entry.source === 'wsc') {
        expect(entry.site, `${key} wsc site`).toMatch(WSC_ID);
      } else if (entry.source === 'cdec') {
        expect(entry.site, `${key} cdec site`).toMatch(CDEC_ID);
        expect(typeof entry.sensor, `${key} cdec sensor`).toBe('number');
      } else {
        expect(entry.source ?? 'usgs', `${key} source`).toBe('usgs');
        expect(entry.site, `${key} usgs site`).toMatch(USGS_ID);
      }
    }
  });

  test('keys are already normalized (lowercase, single-spaced, trimmed)', () => {
    for (const key of Object.keys(table)) {
      expect(key).toBe(key.trim().toLowerCase().replace(/\s+/g, ' '));
    }
  });

  test('each alias key resolves through lookupGauge to its entry', () => {
    for (const [key, entry] of Object.entries(table)) {
      const expected: GaugeRef = {
        site: entry.site,
        source: entry.source ?? 'usgs',
        name: entry.name,
        location: entry.location,
      };
      if (entry.sensor !== undefined) (expected as { sensor?: number }).sensor = entry.sensor;
      if (entry.dur !== undefined) (expected as { dur?: string }).dur = entry.dur;
      expect(lookupGauge(key, table)).toEqual(expected);
    }
  });
});
