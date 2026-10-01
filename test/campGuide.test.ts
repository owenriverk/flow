import { describe, expect, it } from 'vitest';
import mainJson from '../scripts/data/main-salmon-camps.json' with { type: 'json' };
import mfJson from '../scripts/data/mf-salmon-camps.json' with { type: 'json' };
import { PROFILES, TAGS, build, campIds, caps, missingAerials, onDisk } from '../scripts/build-camp-guide.mjs';
import { positions } from '../scripts/build-camp-aerials.mjs';

/**
 * The camp guides are generated static pages (scripts/build-camp-guide.mjs)
 * over hand-edited data files. Three things can go wrong quietly: the data
 * drifts from the Forest Service list it transcribes, someone edits the data
 * and forgets to rebuild the page, or the map and aerials stop lining up with
 * the miles. These tests hold all three, for every river with a guide.
 */

interface Camp {
  m: number;
  n: string;
  s: string;
  lo?: number;
  hi?: number;
  cap?: (number | null)[];
  r?: string | null;
  lay?: boolean;
  hot?: boolean;
  heritage?: boolean;
  noWood?: boolean;
  use?: string[];
  fs?: string;
  d: string;
  src: string[];
  t: string[];
}
interface Data {
  slug: string;
  camps: Camp[];
  sections: { id: string; from: number; to: number }[];
  levels?: { label: string; ft?: number }[];
  anchors?: { mile: number; mark?: string; at?: string }[];
}

const MAIN = mainJson as unknown as Data;
const MF = mfJson as unknown as Data;
const RIVERS: [string, Data][] = [
  ['main-salmon', MAIN],
  ['mf-salmon', MF],
];

describe('every river with a camp-guide profile has a data file here', () => {
  it('lists the same rivers', () => {
    expect(Object.keys(PROFILES).sort()).toEqual(RIVERS.map(([slug]) => slug).sort());
  });
});

describe.each(RIVERS)('%s camp data', (slug, data) => {
  const camps = data.camps;
  const levels = data.levels ?? [{ label: 'Low water' }, { label: 'High water' }];

  it('runs downstream, with a bank and one capacity per level on every camp', () => {
    const miles = camps.map((c) => c.m);
    expect(miles).toEqual([...miles].sort((a, b) => a - b));
    for (const c of camps) {
      expect(['L', 'R', 'C'], `${c.n} side`).toContain(c.s);
      const cs = caps(c);
      expect(cs, `${c.n} capacities`).toHaveLength(levels.length);
      for (const v of cs) expect(v === null || (Number.isInteger(v) && v >= 0 && v <= 30), `${c.n} capacity ${v}`).toBe(true);
    }
  });

  it('gives every camp a sourced description and only known tags', () => {
    for (const c of camps) {
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
  });
});

describe('main-salmon-camps.json matches the Forest Service list', () => {
  const camps = MAIN.camps;

  it('has 92 camps, 20 large and 12 small-medium reservable', () => {
    expect(camps).toHaveLength(92);
    expect(camps.filter((c) => c.r === 'L')).toHaveLength(20);
    expect(camps.filter((c) => c.r === 'S')).toHaveLength(12);
  });

  it('uses only the capacities the list uses, and every camp exists at some level', () => {
    for (const c of camps) {
      expect([0, 10, 15, 20, 30], `${c.n} low`).toContain(c.lo);
      expect([0, 10, 15, 20, 30], `${c.n} high`).toContain(c.hi);
      expect(c.lo! + c.hi!, c.n).toBeGreaterThan(0);
      expect(c.fs, `${c.n} FS remark`).toMatch(/\S/);
    }
  });

  it('never marks a camp large-reservable that cannot hold a large group', () => {
    for (const c of camps.filter((x) => x.r === 'L')) expect(c.lo, c.n).toBe(30);
    for (const c of camps.filter((x) => x.r === 'S')) expect(c.lo, c.n).toBeLessThanOrEqual(20);
  });

  it('disambiguates the two Pebble Beaches by mile', () => {
    const ids = campIds(camps);
    expect(ids).toContain('pebble-beach-mile-19-9');
    expect(ids).toContain('pebble-beach-mile-53-2');
  });
});

describe('mf-salmon-camps.json matches the Forest Service list', () => {
  const camps = MF.camps;

  it('has 98 camps: 6 hot-springs, 7 heritage, 10 no-wood, 49 allowing layovers', () => {
    expect(camps).toHaveLength(98);
    expect(camps.filter((c) => c.hot)).toHaveLength(6);
    expect(camps.filter((c) => c.heritage)).toHaveLength(7);
    expect(camps.filter((c) => c.noWood)).toHaveLength(10);
    expect(camps.filter((c) => c.lay)).toHaveLength(49);
  });

  it('includes Airplane, which the PDF has and the web table leaves out', () => {
    expect(camps.find((c) => c.n === 'Airplane')).toMatchObject({ m: 23.9, s: 'L', cap: [30, 30, 30], lay: true });
  });

  it('only ever leaves the about-4-ft column blank, apart from Indian Creek Beach', () => {
    for (const c of camps) {
      if (c.n === 'Indian Creek Beach') {
        expect(c.cap).toEqual([null, null, null]);
        continue;
      }
      expect(c.cap![0], `${c.n} at 2.5 ft`).not.toBeNull();
      expect(c.cap![2], `${c.n} at 6 ft`).not.toBeNull();
    }
  });

  it('carries a June and a July-August use level on every camp', () => {
    for (const c of camps) {
      expect(c.use, c.n).toHaveLength(2);
      for (const u of c.use!) expect(['Low', 'Mid', 'High', 'Very High'], c.n).toContain(u);
    }
  });

  it('allows no layovers in the one-night stretch below Big Creek, as the page says', () => {
    expect(camps.filter((c) => c.m > 78.2 && c.lay).map((c) => c.n)).toEqual([]);
  });
});

describe.each(RIVERS)('web/%s-camps.html', (slug, data) => {
  const { html, aerials } = build(slug);

  it('is rebuilt whenever the data or the generator changes', () => {
    // Fails after an edit without `node scripts/build-camp-guide.mjs`.
    expect(onDisk(slug)).toBe(html);
  });

  it('renders every camp once, with the strip map and no template leaks', () => {
    for (const id of campIds(data.camps)) {
      expect(html.split(`<article class="camp" id="${id}"`).length - 1, id).toBe(1);
    }
    expect(html).toContain(`data-camp-rail="/${slug}-data.js"`);
    expect(html).not.toMatch(/undefined|NaN|\[object Object\]/);
  });

  it('pins the strip map only at marks that exist in the river map data', async () => {
    const { MARKS } = await import(`../web/${slug}-data.js`);
    const names = new Set((MARKS as { name: string }[]).map((m) => m.name));
    const pinned = (data.anchors ?? []).filter((a) => a.mark);
    expect(pinned.length).toBeGreaterThan(0);
    for (const a of pinned) expect(names.has(a.mark!), a.mark).toBe(true);
  });

  it('has an aerial on disk for every camp, framed where the anchors put it', () => {
    const entries = (aerials as { camps: Record<string, { file: string; date: string; lat: number; lon: number }> }).camps;
    expect(Object.keys(entries).sort()).toEqual([...campIds(data.camps)].sort());
    expect(missingAerials(slug, aerials)).toEqual([]);
    const where = positions(data) as Record<string, { lat: number; lon: number }>;
    for (const [id, a] of Object.entries(entries)) {
      const w = where[id];
      expect(w, id).toBeDefined();
      if (!w) continue;
      expect(a.date, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Within 25 m of where the anchors place the camp today. A frame is 1.2 km
      // across; a bigger shift means the data or anchors moved and the aerial is stale.
      const metres = Math.hypot((a.lat - w.lat) * 111320, (a.lon - w.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180));
      expect(metres, id).toBeLessThan(25);
      expect(html, id).toContain(`img/camps/${slug}/${a.file}`);
    }
  });
});

describe('page statements follow the data', () => {
  it('Main: counts the low-water-only camps', () => {
    const { html, data } = build('main-salmon');
    const lowOnly = (data.camps as Camp[]).filter((c) => c.hi === 0).length;
    expect(html).toContain(`${lowOnly} of the\n      92 camps are beaches that do not exist at high water`);
    expect(html).toContain('<dd>20 large, 12 small-medium</dd>');
  });

  it('Middle Fork: names the gauge the feet refer to and offers a live reading', () => {
    const { html } = build('mf-salmon');
    expect(html).toContain('(USGS 13309220)');
    expect(html).toContain('data-gauge-key="middle fork salmon"');
    expect(html).toContain('data-levels-ft="2.5,4,6"');
    expect(html).toContain('<dd>6 camps, one per trip</dd>');
  });

  it('Main has no live line: its list has no gauge feet', () => {
    expect(build('main-salmon').html).not.toContain('id="camp-live"');
  });
});
