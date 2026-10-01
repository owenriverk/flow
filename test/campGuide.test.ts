import { describe, expect, it } from 'vitest';
import campsJson from '../scripts/data/main-salmon-camps.json' with { type: 'json' };
import { TAGS, build, campIds, missingAerials, onDisk } from '../scripts/build-camp-guide.mjs';

/**
 * The camp guide is a generated static page (scripts/build-camp-guide.mjs) over
 * a hand-edited data file. Two things can go wrong quietly: the data drifts
 * from the Forest Service list it transcribes, or someone edits the data and
 * forgets to rebuild the page. These tests hold both.
 */

interface Camp {
  m: number;
  n: string;
  s: string;
  lo: number;
  hi: number;
  r: string | null;
  fs: string;
  d: string;
  src: string[];
  t: string[];
}

const data = campsJson as unknown as { camps: Camp[]; sections: { id: string; from: number; to: number }[] };
const camps = data.camps;

describe('main-salmon-camps.json', () => {
  it('matches the shape of the Forest Service list: 92 camps, 20 large and 12 small-medium reservable', () => {
    expect(camps).toHaveLength(92);
    expect(camps.filter((c) => c.r === 'L')).toHaveLength(20);
    expect(camps.filter((c) => c.r === 'S')).toHaveLength(12);
  });

  it('runs downstream, with a bank and Forest Service capacities on every camp', () => {
    const miles = camps.map((c) => c.m);
    expect(miles).toEqual([...miles].sort((a, b) => a - b));
    for (const c of camps) {
      expect(['L', 'R'], `${c.n} side`).toContain(c.s);
      // The list only ever uses these capacities.
      expect([0, 10, 15, 20, 30], `${c.n} low`).toContain(c.lo);
      expect([0, 10, 15, 20, 30], `${c.n} high`).toContain(c.hi);
      expect(c.lo + c.hi, `${c.n} is a camp at some level`).toBeGreaterThan(0);
      expect([null, 'L', 'S'], `${c.n} reservable`).toContain(c.r);
    }
  });

  it('never marks a camp large-reservable that cannot hold a large group', () => {
    for (const c of camps.filter((x) => x.r === 'L')) expect(c.lo, c.n).toBe(30);
    for (const c of camps.filter((x) => x.r === 'S')) expect(c.lo, c.n).toBeLessThanOrEqual(20);
  });

  it('gives every camp a sourced description and only known tags', () => {
    for (const c of camps) {
      expect(c.fs, `${c.n} FS remark`).toMatch(/\S/);
      expect(c.d.length, `${c.n} description`).toBeGreaterThan(20);
      expect(c.src, `${c.n} sources`).toContain('fs');
      for (const tag of c.t) expect(Object.keys(TAGS), `${c.n} tag ${tag}`).toContain(tag);
    }
  });

  it('places every camp in exactly one section and gives it a unique anchor', () => {
    for (const c of camps) {
      expect(data.sections.filter((s) => c.m >= s.from && c.m < s.to), c.n).toHaveLength(1);
    }
    const ids = campIds(camps);
    expect(new Set(ids).size).toBe(ids.length);
    // Two Pebble Beaches: the mile disambiguates.
    expect(ids).toContain('pebble-beach-mile-19-9');
    expect(ids).toContain('pebble-beach-mile-53-2');
  });
});

describe('web/main-salmon-camps.html', () => {
  const { html, aerials } = build('main-salmon');

  it('is rebuilt whenever the data or the generator changes', () => {
    // Fails after an edit without `node scripts/build-camp-guide.mjs`.
    expect(onDisk('main-salmon')).toBe(html);
  });

  it('renders every camp once, with the strip map and no template leaks', () => {
    for (const id of campIds(camps)) {
      expect(html.split(`<article class="camp" id="${id}"`).length - 1, id).toBe(1);
    }
    expect(html).toContain('data-camp-rail="/main-salmon-data.js"');
    expect(html).not.toMatch(/undefined|NaN|\[object Object\]/);
  });

  it('has an aerial on disk for every camp, each dated and with a downstream bearing', () => {
    const entries = (aerials as { camps: Record<string, { file: string; date: string; bearing: number; lat: number; lon: number }> }).camps;
    expect(Object.keys(entries).sort()).toEqual([...campIds(camps)].sort());
    expect(missingAerials('main-salmon', aerials)).toEqual([]);
    for (const [id, a] of Object.entries(entries)) {
      expect(a.date, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.bearing, id).toBeGreaterThanOrEqual(0);
      expect(a.bearing, id).toBeLessThan(360);
      // Inside the canyon between Corn Creek and Long Tom Bar, not somewhere else on Earth.
      expect(a.lat, id).toBeGreaterThan(45.2);
      expect(a.lat, id).toBeLessThan(45.7);
      expect(a.lon, id).toBeGreaterThan(-116.0);
      expect(a.lon, id).toBeLessThan(-114.6);
      expect(html, id).toContain(`img/camps/main-salmon/${a.file}`);
    }
  });

  it('states the counts the data implies', () => {
    const lowOnly = camps.filter((c) => c.hi === 0).length;
    expect(html).toContain(`${lowOnly} of the\n      92 camps are beaches that do not exist at high water`);
    expect(html).toContain('<dd>20 large, 12 small-medium</dd>');
  });
});
