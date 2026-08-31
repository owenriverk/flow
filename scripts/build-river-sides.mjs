/**
 * Builds the scroll-map data for the Sierra forecast pages — the same idea as
 * the Stikine rail (owenkurth/scripts/build-stikine-topo.mjs, whose geometry
 * math this reuses): the run's real OSM centerline in a km frame rotated so the
 * river flows down the page, elevation contours around it, and the named marks
 * placed by river-kilometre.
 *
 * Per river it writes web/<slug>-data.js and web/<slug>-topo.svg, read by
 * web/river-side.js (the generic engine behind the aside on each detail page).
 *
 * Sources:
 *  - centerlines + lakes + falls: OpenStreetMap via Overpass, cached in
 *    scripts/data/*.json (see the fetch commands in git history)
 *  - elevation: AWS terrain tiles, skadi HGT (SRTM 1-arcsecond, ~25-30 m cells)
 *  - marks tagged `at:` sit at surveyed OSM coordinates snapped to the line;
 *    marks tagged `km:` are paddler-beta estimates measured from the put-in —
 *    correct those as better numbers turn up.
 *
 * Run: node scripts/build-river-sides.mjs   (HGT tiles cached in node_modules/.cache)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const DATA = new URL("./data/", import.meta.url);
const WEB = new URL("../web/", import.meta.url);
const CACHE = "node_modules/.cache/skadi-tiles";
const KM_DEG = 111.32;
const LEVEL_STEP = 40; // metres
const INDEX_EVERY = 200;
const PAD_X = 1.6; // km of topo beyond the river's lateral extent
const PAD_Y = 0.8;
const SIMPLIFY_EPS = 0.015; // km
const RIVER_EPS = 0.01;
const QUANT = 200; // svg units per km
const MIN_POINTS = 4;
const MIN_LENGTH = 0.12; // km

const RIVERS = [
  {
    slug: "kings",
    osm: "kings-osm.json",
    names: ["Middle Fork Kings River"],
    putIn: { at: [37.088, -118.598] }, // LeConte Canyon, Bishop Pass trail
    takeOut: { end: true }, // the chain ends at the South Fork confluence
    span: "LeConte Canyon → the confluence",
    marks: [
      { name: "Devils Washbowl", kind: "rapid", km: 8 }, // beta estimate
      { name: "Simpson Meadow", kind: "camp", km: 21 }, // beta estimate
      { name: "Tehipite Valley", kind: "camp", at: "kings-marks.json:Tehipite Dome" },
      { name: "the Bottom Nine", kind: "rapid", kmFromEnd: 7.2 }, // beta estimate — mid-section; the section starts right below Tehipite
    ],
    tribs: [{ osm: "kings-marks.json", names: ["South Fork Kings River"] }],
  },
  {
    slug: "cherry",
    osm: "cherry-osm.json",
    names: ["Cherry Creek"],
    putIn: { kmAboveTakeOut: 14.5 }, // ~9 miles of granite above the lake
    takeOut: { lake: "Cherry Lake" },
    span: "put-in slabs → Cherry Lake",
    marks: [
      // all beta estimates — nothing on this run carries an OSM name
      { name: "Cherry Bomb Gorge", kind: "rapid", km: 5.5 },
      { name: "Flintstone Camp", kind: "camp", km: 8 },
      { name: "the Teacups", kind: "rapid", km: 13 },
    ],
    tribs: [],
  },
  {
    slug: "fantasy",
    osm: "moke-osm.json",
    names: ["North Fork Mokelumne River"],
    putIn: { at: [38.5386, -119.9033] }, // Hermit Valley, Highway 4
    takeOut: { lake: "Salt Springs Reservoir" },
    span: "Hermit Valley → Salt Springs",
    marks: [
      { name: "Summit City Creek", kind: "camp", at: "moke-marks.json:way:Summit City Creek" },
      { name: "Fantasy Falls", kind: "rapid", frac: 0.55 }, // beta estimate
    ],
    tribs: [{ osm: "moke-marks.json", names: ["Summit City Creek"] }],
  },
  {
    slug: "postpile",
    osm: "sanjoaquin-osm.json",
    names: ["Middle Fork San Joaquin River", "San Joaquin River"],
    putIn: { at: [37.6299, -119.085] }, // Devils Postpile Monument
    takeOut: { lake: "Mammoth Pool Reservoir" },
    span: "Devils Postpile → Mammoth Pool",
    marks: [
      { name: "Rainbow Falls", kind: "rapid", at: "sj-marks.json:Rainbow Falls" },
      { name: "Fish Creek", kind: "camp", at: "sj-marks.json:way:Fish Creek" },
      { name: "North Fork joins", kind: "rapid", at: "sj-marks.json:way:North Fork San Joaquin River" },
    ],
    tribs: [
      { osm: "sj-marks.json", names: ["Fish Creek"] },
      { osm: "sj-marks.json", names: ["North Fork San Joaquin River"] },
    ],
  },
];

// ---- geometry helpers (same shapes as the Stikine script) -------------------

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function dpSimplify(points, eps) {
  if (points.length < 3) return points;
  const [x1, y1] = points[0];
  const [x2, y2] = points[points.length - 1];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const norm = Math.hypot(dx, dy) || 1e-12;
  let dmax = 0;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [x0, y0] = points[i];
    const d = Math.abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / norm;
    if (d > dmax) {
      dmax = d;
      idx = i;
    }
  }
  if (dmax > eps) {
    const left = dpSimplify(points.slice(0, idx + 1), eps);
    const right = dpSimplify(points.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[points.length - 1]];
}

const loadJson = (file) => JSON.parse(readFileSync(new URL(file, DATA), "utf8"));

// chain OSM ways (digitized downstream) into the longest head→mouth line
function chainWays(json, names) {
  const ways = json.elements.filter((e) => e.type === "way" && names.includes(e.tags?.name));
  const key = (p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  const byStart = new Map();
  for (const w of ways) {
    const k = key(w.geometry[0]);
    (byStart.get(k) ?? byStart.set(k, []).get(k)).push(w);
  }
  const hasIncoming = new Set(ways.map((w) => key(w.geometry[w.geometry.length - 1])));
  const heads = ways.filter((w) => !hasIncoming.has(key(w.geometry[0])));
  const lenOf = (g) => {
    let L = 0;
    for (let i = 1; i < g.length; i += 1)
      L += Math.hypot((g[i].lat - g[i - 1].lat) * KM_DEG, (g[i].lon - g[i - 1].lon) * KM_DEG * Math.cos((g[i].lat * Math.PI) / 180));
    return L;
  };
  const best = (w, seen) => {
    if (seen.has(w.id)) return { len: 0, path: [] };
    seen.add(w.id);
    const nexts = byStart.get(key(w.geometry[w.geometry.length - 1])) ?? [];
    let b = { len: 0, path: [] };
    for (const n of nexts) {
      const r = best(n, seen);
      if (r.len > b.len) b = r;
    }
    return { len: lenOf(w.geometry) + b.len, path: [w, ...b.path] };
  };
  let top = { len: 0, path: [] };
  for (const h of heads) {
    const r = best(h, new Set());
    if (r.len > top.len) top = r;
  }
  const pts = [];
  for (const w of top.path)
    for (const p of w.geometry) {
      const last = pts[pts.length - 1];
      if (!last || last[0] !== p.lat || last[1] !== p.lon) pts.push([p.lat, p.lon]);
    }
  return pts;
}

// point-in-polygon for the reservoir inlets (ray cast, lat/lon)
function inPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [ay, ax] = poly[i];
    const [by, bx] = poly[j];
    if (ay > pt[0] !== by > pt[0] && pt[1] < ((bx - ax) * (pt[0] - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

const lakesJson = loadJson("lakes-osm.json");
function lakePolys(name) {
  const polys = [];
  for (const e of lakesJson.elements) {
    if (e.tags?.name !== name) continue;
    if (e.type === "way" && e.geometry) polys.push(e.geometry.map((p) => [p.lat, p.lon]));
    if (e.type === "relation")
      for (const m of e.members ?? [])
        if (m.geometry && m.role !== "inner") polys.push(m.geometry.map((p) => [p.lat, p.lon]));
  }
  return polys;
}

// resolve "file.json:Name" (node) or "file.json:way:Name" (way mouth) to [lat, lon]
function resolveAt(ref) {
  if (Array.isArray(ref)) return ref;
  const [file, ...rest] = ref.split(":");
  const j = loadJson(file);
  if (rest[0] === "way") {
    const name = rest.slice(1).join(":");
    const ways = j.elements.filter((e) => e.type === "way" && e.tags?.name === name);
    const pts = chainWays(j, [name]);
    if (!pts.length) throw new Error(`no way named ${name} in ${file} (${ways.length} ways)`);
    return pts[pts.length - 1]; // the mouth
  }
  const name = rest.join(":");
  const n = j.elements.find((e) => e.type === "node" && e.tags?.name === name);
  if (!n) throw new Error(`no node named ${name} in ${file}`);
  return [n.lat, n.lon];
}

// ---- skadi HGT elevation mosaic --------------------------------------------

const hgtCache = new Map();
async function hgtTile(latF, lonF) {
  const id = `${latF >= 0 ? "N" : "S"}${String(Math.abs(latF)).padStart(2, "0")}${lonF >= 0 ? "E" : "W"}${String(Math.abs(lonF)).padStart(3, "0")}`;
  if (hgtCache.has(id)) return hgtCache.get(id);
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
  const file = `${CACHE}/${id}.hgt`;
  let buf;
  if (existsSync(file)) buf = readFileSync(file);
  else {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/skadi/${id.slice(0, 3)}/${id}.hgt.gz`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`tile ${url}: ${r.status}`);
    buf = gunzipSync(Buffer.from(await r.arrayBuffer()));
    writeFileSync(file, buf);
  }
  const n = Math.sqrt(buf.length / 2); // 3601
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tile = { n, at: (row, col) => view.getInt16((row * n + col) * 2, false) };
  hgtCache.set(id, tile);
  return tile;
}

// elevation grid over a lat/lon window at 1-arcsecond steps
async function demGrid(bbox) {
  const step = 1 / 3600;
  const rows = Math.ceil((bbox.latMax - bbox.latMin) / step) + 2;
  const cols = Math.ceil((bbox.lonMax - bbox.lonMin) / step) + 2;
  const lat0 = bbox.latMax;
  const lon0 = bbox.lonMin;
  const grid = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r += 1) {
    const lat = lat0 - r * step;
    const latF = Math.floor(lat);
    for (let c = 0; c < cols; c += 1) {
      const lon = lon0 + c * step;
      const lonF = Math.floor(lon);
      const tile = await hgtTile(latF, lonF);
      const row = Math.round((latF + 1 - lat) * (tile.n - 1));
      const col = Math.round((lon - lonF) * (tile.n - 1));
      const e = tile.at(Math.min(tile.n - 1, Math.max(0, row)), Math.min(tile.n - 1, Math.max(0, col)));
      grid[r * cols + c] = e === -32768 ? 0 : e;
    }
  }
  return { grid, rows, cols, lat0, lon0, step };
}

const MS = {
  1: [["l", "b"]], 2: [["b", "r"]], 3: [["l", "r"]], 4: [["t", "r"]],
  5: [["t", "l"], ["b", "r"]], 6: [["t", "b"]], 7: [["t", "l"]],
  8: [["t", "l"]], 9: [["t", "b"]], 10: [["t", "r"], ["l", "b"]],
  11: [["t", "r"]], 12: [["l", "r"]], 13: [["b", "r"]], 14: [["l", "b"]]
};

// ---- per-river build --------------------------------------------------------

async function build(cfg) {
  const raw = chainWays(loadJson(cfg.osm), cfg.names);
  const lat0 = raw.reduce((a, p) => a + p[0], 0) / raw.length;
  const lon0 = raw.reduce((a, p) => a + p[1], 0) / raw.length;
  const cos0 = Math.cos((lat0 * Math.PI) / 180);
  const toEN = ([lat, lon]) => [(lon - lon0) * KM_DEG * cos0, (lat - lat0) * KM_DEG];
  const fromEN = ([e, n]) => [lat0 + n / KM_DEG, lon0 + e / (KM_DEG * cos0)];

  const riverEN = raw.map(toEN);
  const cum = [0];
  for (let i = 1; i < riverEN.length; i += 1) cum.push(cum[i - 1] + dist(riverEN[i - 1], riverEN[i]));
  const total = cum[cum.length - 1];

  const kmNearest = (ll) => {
    const p = toEN(ll);
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < riverEN.length; i += 1) {
      const d = dist(riverEN[i], p);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return { km: cum[bi], off: bd };
  };
  const pointAtKm = (k) => {
    let i = cum.findIndex((c) => c >= k);
    if (i <= 0) return riverEN[0];
    if (i === -1) return riverEN[riverEN.length - 1];
    const t = (k - cum[i - 1]) / (cum[i] - cum[i - 1] || 1e-12);
    const a = riverEN[i - 1];
    const b = riverEN[i];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };

  // take-out first (the put-in may be defined relative to it)
  let outKm;
  if (cfg.takeOut.end) outKm = total;
  else if (cfg.takeOut.lake) {
    const polys = lakePolys(cfg.takeOut.lake);
    if (!polys.length) throw new Error(`no polygon for ${cfg.takeOut.lake}`);
    const idx = raw.findIndex((p) => polys.some((poly) => inPoly(p, poly)));
    if (idx < 0) throw new Error(`${cfg.slug}: river never enters ${cfg.takeOut.lake}`);
    outKm = cum[idx];
  } else outKm = kmNearest(cfg.takeOut.at).km;

  let putKm;
  if (cfg.putIn.at) {
    const r = kmNearest(cfg.putIn.at);
    putKm = r.km;
    console.log(`  put-in snaps ${r.off.toFixed(2)} km off the line at river-km ${r.km.toFixed(1)}`);
  } else putKm = outKm - cfg.putIn.kmAboveTakeOut;

  const runLen = outKm - putKm;
  console.log(`  cut: km ${putKm.toFixed(1)} → ${outKm.toFixed(1)} of ${total.toFixed(1)} (run ${runLen.toFixed(1)} km)`);

  const cutEN = [pointAtKm(putKm)]
    .concat(riverEN.filter((_, i) => cum[i] > putKm && cum[i] < outKm))
    .concat([pointAtKm(outKm)]);

  // rotate so downstream runs down the page with least sideways wander
  let bestR = null;
  for (let deg = 0; deg < 360; deg += 0.25) {
    const th = (deg * Math.PI) / 180;
    const D = [Math.sin(th), Math.cos(th)];
    const R = [-D[1], D[0]];
    const ys = cutEN.map((p) => p[0] * D[0] + p[1] * D[1]);
    const drop = ys[ys.length - 1] - ys[0];
    if (drop < 0.9 * (Math.max(...ys) - Math.min(...ys))) continue;
    const xs = cutEN.map((p) => p[0] * R[0] + p[1] * R[1]);
    const span = Math.max(...xs) - Math.min(...xs);
    if (!bestR || span < bestR.span) bestR = { deg, span, D, R };
  }
  const { D, R } = bestR;
  const toFrame = ([e, n]) => [e * R[0] + n * R[1], e * D[0] + n * D[1]];
  const fromFrame = ([x, y]) => [x * R[0] + y * D[0], x * R[1] + y * D[1]];

  const cutF = cutEN.map(toFrame);
  const x0 = Math.min(...cutF.map((p) => p[0]));
  const y0 = Math.min(...cutF.map((p) => p[1]));
  const W = Math.max(...cutF.map((p) => p[0])) - x0;
  const H = Math.max(...cutF.map((p) => p[1])) - y0;
  const local = ([x, y]) => [x - x0, y - y0];
  const river = dpSimplify(cutF.map(local), RIVER_EPS);
  const northPage = toFrame([0, 1]);
  const NORTH = (Math.atan2(northPage[0], -northPage[1]) * 180) / Math.PI;
  console.log(`  frame: bearing ${bestR.deg}°, ${W.toFixed(2)} × ${H.toFixed(2)} km, north ${NORTH.toFixed(1)}°, river ${river.length} pts`);

  // marks → run-km (from the put-in) → frame
  const marks = [];
  for (const m of cfg.marks) {
    let km;
    if (m.at) {
      const r = kmNearest(resolveAt(m.at));
      km = r.km - putKm;
      console.log(`  mark "${m.name}": snapped ${r.off.toFixed(2)} km off the line at run-km ${km.toFixed(1)}`);
    } else if (m.kmFromEnd !== undefined) km = runLen - m.kmFromEnd;
    else if (m.frac !== undefined) km = runLen * m.frac;
    else km = m.km;
    if (km < 0.3 || km > runLen - 0.1) {
      console.log(`  mark "${m.name}" at run-km ${km.toFixed(1)} is outside the cut — dropped`);
      continue;
    }
    const [x, y] = local(toFrame(pointAtKm(putKm + km)));
    marks.push({ name: m.name, km: +km.toFixed(1), kind: m.kind, x: +x.toFixed(3), y: +y.toFixed(3) });
  }

  // tribs: chain each, keep the part inside the padded frame (walk up from the mouth)
  const inWin = ([x, y]) => x >= -PAD_X && x <= W + PAD_X && y >= -PAD_Y && y <= H + PAD_Y;
  const tribs = [];
  for (const t of cfg.tribs) {
    const pts = chainWays(loadJson(t.osm), t.names).map((ll) => local(toFrame(toEN(ll))));
    let run = [];
    for (let i = pts.length - 1; i >= 0; i -= 1) {
      if (!inWin(pts[i])) break;
      run.unshift(pts[i]);
    }
    if (run.length >= 2) tribs.push(dpSimplify(run, RIVER_EPS));
  }

  // DEM window and contours
  const cornersLL = [
    [-PAD_X, -PAD_Y],
    [W + PAD_X, -PAD_Y],
    [-PAD_X, H + PAD_Y],
    [W + PAD_X, H + PAD_Y]
  ].map(([x, y]) => fromEN(fromFrame([x + x0, y + y0])));
  const bbox = {
    latMin: Math.min(...cornersLL.map((p) => p[0])),
    latMax: Math.max(...cornersLL.map((p) => p[0])),
    lonMin: Math.min(...cornersLL.map((p) => p[1])),
    lonMax: Math.max(...cornersLL.map((p) => p[1]))
  };
  const dem = await demGrid(bbox);
  const cellToFrame = (c, r) => local(toFrame(toEN([dem.lat0 - r * dem.step, dem.lon0 + c * dem.step])));

  let emin = Infinity;
  let emax = -Infinity;
  for (let r = 0; r < dem.rows; r += 1)
    for (let c = 0; c < dem.cols; c += 1) {
      if (!inWin(cellToFrame(c, r))) continue;
      const e = dem.grid[r * dem.cols + c];
      emin = Math.min(emin, e);
      emax = Math.max(emax, e);
    }
  const levels = [];
  for (let e = Math.ceil(emin / LEVEL_STEP) * LEVEL_STEP; e < emax; e += LEVEL_STEP) levels.push(e);
  console.log(`  elevation ${Math.round(emin)}–${Math.round(emax)} m, ${levels.length} levels`);

  function contour(level) {
    const segs = [];
    const lerp = (a, b) => (level - a) / (b - a);
    for (let r = 0; r < dem.rows - 1; r += 1) {
      for (let c = 0; c < dem.cols - 1; c += 1) {
        const tl = dem.grid[r * dem.cols + c];
        const tr = dem.grid[r * dem.cols + c + 1];
        const br = dem.grid[(r + 1) * dem.cols + c + 1];
        const bl = dem.grid[(r + 1) * dem.cols + c];
        let ci = 0;
        if (tl >= level) ci |= 8;
        if (tr >= level) ci |= 4;
        if (br >= level) ci |= 2;
        if (bl >= level) ci |= 1;
        if (ci === 0 || ci === 15) continue;
        const pts = {
          t: [c + lerp(tl, tr), r],
          r: [c + 1, r + lerp(tr, br)],
          b: [c + lerp(bl, br), r + 1],
          l: [c, r + lerp(tl, bl)]
        };
        for (const [a, b] of MS[ci]) segs.push([pts[a], pts[b]]);
      }
    }
    const key = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
    const byStart = new Map();
    const byEnd = new Map();
    for (const s of segs) {
      (byStart.get(key(s[0])) ?? byStart.set(key(s[0]), []).get(key(s[0]))).push(s);
      (byEnd.get(key(s[1])) ?? byEnd.set(key(s[1]), []).get(key(s[1]))).push(s);
    }
    const used = new Set();
    const lines = [];
    for (const s of segs) {
      if (used.has(s)) continue;
      used.add(s);
      const line = [s[0], s[1]];
      for (let g = 0; g < 100000; g += 1) {
        const next = (byStart.get(key(line[line.length - 1])) || []).find((c2) => !used.has(c2));
        if (!next) break;
        used.add(next);
        line.push(next[1]);
      }
      for (let g = 0; g < 100000; g += 1) {
        const prev = (byEnd.get(key(line[0])) || []).find((c2) => !used.has(c2));
        if (!prev) break;
        used.add(prev);
        line.unshift(prev[0]);
      }
      lines.push(line);
    }
    return lines;
  }

  const q = (v) => Math.round(v * QUANT);
  function pathData(line) {
    let d = `M${q(line[0][0])} ${q(line[0][1])}`;
    let px = q(line[0][0]);
    let py = q(line[0][1]);
    for (let i = 1; i < line.length; i += 1) {
      const x = q(line[i][0]);
      const y = q(line[i][1]);
      if (x === px && y === py) continue;
      d += `l${x - px} ${y - py}`;
      px = x;
      py = y;
    }
    return d;
  }

  const plain = [];
  const index = [];
  for (const level of levels) {
    const bucket = level % INDEX_EVERY === 0 ? index : plain;
    for (const line of contour(level)) {
      const mapped = line.map(([c, r]) => cellToFrame(c, r));
      let run = [];
      const flush = () => {
        if (run.length >= MIN_POINTS) {
          const simp = dpSimplify(run, SIMPLIFY_EPS);
          let len = 0;
          for (let i = 1; i < simp.length; i += 1) len += dist(simp[i - 1], simp[i]);
          if (simp.length >= 2 && len >= MIN_LENGTH) bucket.push(pathData(simp));
        }
        run = [];
      };
      for (const p of mapped) {
        if (inWin(p)) run.push(p);
        else flush();
      }
      flush();
    }
  }
  console.log(`  contours: ${plain.length + index.length} polylines (${index.length} index)`);

  const vb = [q(-PAD_X), q(-PAD_Y), q(W + 2 * PAD_X), q(H + 2 * PAD_Y)];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(" ")}" fill="none" stroke-linejoin="round" stroke-linecap="round">\n` +
    `<!-- ${LEVEL_STEP} m contours (index every ${INDEX_EVERY} m) around the ${cfg.slug} run. Units 1/${QUANT} km. ` +
    `Source: AWS terrain tiles (skadi/SRTM 1-arcsec). Regenerate: node scripts/build-river-sides.mjs -->\n` +
    `<g class="c">\n${plain.map((d) => `<path d="${d}"/>`).join("\n")}\n</g>\n` +
    `<g class="i">\n${index.map((d) => `<path d="${d}"/>`).join("\n")}\n</g>\n</svg>\n`;
  writeFileSync(new URL(`${cfg.slug}-topo.svg`, WEB), svg);

  const round = (pts) => pts.map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]);
  const js = `// Generated by scripts/build-river-sides.mjs — do not edit.
// ${cfg.span}, ${runLen.toFixed(1)} km, in kilometres (x page-right, y downstream);
// contours in ${cfg.slug}-topo.svg share the frame. Marks with surveyed OSM anchors
// are exact; the rest are paddler-beta river-km estimates (see the generator config).
export const FRAME = ${JSON.stringify({ w: +W.toFixed(3), h: +H.toFixed(3) })};
export const NORTH = ${NORTH.toFixed(1)};
export const TOPO = ${JSON.stringify({ href: `/${cfg.slug}-topo.svg`, unitsPerKm: QUANT })};
export const RIVER = ${JSON.stringify(round(river))};
export const TRIBS = ${JSON.stringify(tribs.map(round))};
export const MARKS = ${JSON.stringify(marks)};
`;
  writeFileSync(new URL(`${cfg.slug}-data.js`, WEB), js);
  console.log(`  wrote web/${cfg.slug}-data.js (${(js.length / 1024).toFixed(0)} KB) + web/${cfg.slug}-topo.svg (${(svg.length / 1024).toFixed(0)} KB)`);
  return { slug: cfg.slug, span: cfg.span, runLen };
}

for (const cfg of RIVERS) {
  console.log(`${cfg.slug}:`);
  await build(cfg);
}
