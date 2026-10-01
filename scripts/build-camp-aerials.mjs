/**
 * One aerial photograph per camp for the camp guides.
 *
 *   scripts/data/<slug>-camps.json  ->  web/img/camps/<slug>/<camp>-aerial-<year>.webp
 *                                       scripts/data/<slug>-aerials.json  (read by build-camp-guide.mjs)
 *
 * Why aerials: nobody publishes ground photos of these camps that can be reused
 * (checked 2026-09-30: Wikimedia Commons, Flickr CC/US-government, the Forest
 * Service). USDA's NAIP orthoimagery is public domain, covers every camp, and
 * shows what a permit holder actually wants to see — the beach, the bench, the
 * tree cover, the eddy.
 *
 * Where a camp is: the Forest Service gives river miles, not coordinates. This
 * lays each mile along the same OSM centerline the maps use, measured from the
 * put-in, and pins it at the river's `anchors` (creek mouths whose Forest
 * Service mile is known, in the camps JSON): the OSM line drifts from the
 * Forest Service's miles by up to a mile on the Middle Fork, so a raw
 * mile x 1.609 would put some frames on the wrong reach. Between anchors it is
 * good to about a quarter mile, so the frame is 1.2 km wide and the caption says
 * the camp is near the middle rather than pretending to pinpoint the tent sites.
 *
 * What water level: whatever the day of the flight was. Each tile's acquisition
 * date comes from the image service's catalog, and the reference gauge on that
 * date is recorded beside it — daily mean cfs, and, for rivers whose camp list
 * is in feet (the Middle Fork), the mean gauge height from the historical
 * instantaneous record (USGS keeps no daily gauge-height series there).
 *
 * Sources:
 *   imagery  https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer
 *   flow     https://waterservices.usgs.gov/nwis/dv/ (daily mean discharge, 00060)
 *   stage    https://nwis.waterservices.usgs.gov/nwis/iv/ (gauge height, 00065)
 *
 * Raw JPEGs are cached in node_modules/.cache/camp-aerials, keyed by camp and
 * year, so a re-run only fetches what is missing. Delete the cache entry if a
 * camp's position changes. Needs `cwebp` on PATH.
 *
 * Run: node scripts/build-camp-aerials.mjs [slug ...]        (default: main-salmon)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KM_DEG, RIVERS, chainWays, loadJson, resolveAt } from "./build-river-sides.mjs";
import { campIds } from "./build-camp-guide.mjs";

const ROOT = new URL("../", import.meta.url);
const CACHE = "node_modules/.cache/camp-aerials";
const IMAGE_SERVER = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer";
const KM_PER_MILE = 1.609344;
// Ground covered, east-west x north-south. 0.9 km was too tight: with quarter-
// mile accuracy Alder Creek's beach landed on the frame edge.
const FRAME_KM = [1.2, 0.9];
const FETCH_PX = [1350, 1012]; // asked of the server (imagery is 0.6 m here)
const OUT_PX = [900, 675];
const WEBP_QUALITY = "52";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url, tries = 6) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.ok) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (err) {
      last = err;
    }
    await sleep(3000 * (i + 1)); // the image server throws the odd 502 under load
  }
  throw last;
}

/** Piecewise-linear map from Forest Service mile to line mile through [fsMile, lineMile] pairs. */
export function makeLineMile(pairs) {
  const pts = [[0, 0], ...pairs].sort((a, b) => a[0] - b[0]);
  return (mile) => {
    for (let i = 1; i < pts.length; i += 1) {
      const [m0, l0] = pts[i - 1];
      const [m1, l1] = pts[i];
      if (mile <= m1) return l0 + ((l1 - l0) * (mile - m0)) / (m1 - m0);
    }
    const [mLast, lLast] = pts[pts.length - 1];
    return mile + (lLast - mLast); // below the last anchor, its offset carries on
  };
}

/** The river as [lat, lon] along the OSM centerline, pinned at the data file's anchors. */
function centerline(data) {
  const cfg = RIVERS.find((r) => r.slug === data.slug);
  if (!cfg) throw new Error(`no river config for ${data.slug} in build-river-sides.mjs`);
  const raw = chainWays(loadJson(cfg.osm), cfg.names);
  const lat0 = raw.reduce((a, p) => a + p[0], 0) / raw.length;
  const lon0 = raw.reduce((a, p) => a + p[1], 0) / raw.length;
  const cos0 = Math.cos((lat0 * Math.PI) / 180);
  // Same flat projection build-river-sides.mjs uses, so miles land where the maps put them.
  const toEN = ([lat, lon]) => [(lon - lon0) * KM_DEG * cos0, (lat - lat0) * KM_DEG];
  const fromEN = ([e, n]) => [lat0 + n / KM_DEG, lon0 + e / (KM_DEG * cos0)];
  const en = raw.map(toEN);
  const cum = [0];
  for (let i = 1; i < en.length; i += 1) cum.push(cum[i - 1] + Math.hypot(en[i][0] - en[i - 1][0], en[i][1] - en[i - 1][1]));

  const nearestKm = (ll) => {
    const p = toEN(ll);
    let best = 0;
    let bd = Infinity;
    en.forEach((q, i) => {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < bd) [bd, best] = [d, i];
    });
    return cum[best];
  };
  const pointAt = (km) => {
    const k = Math.min(cum[cum.length - 1], Math.max(0, km));
    let i = cum.findIndex((c) => c >= k);
    if (i <= 0) i = 1;
    const t = (k - cum[i - 1]) / (cum[i] - cum[i - 1] || 1e-12);
    return [en[i - 1][0] + (en[i][0] - en[i - 1][0]) * t, en[i - 1][1] + (en[i][1] - en[i - 1][1]) * t];
  };
  const km0 = nearestKm(resolveAt(cfg.putIn.at));
  const anchors = (data.anchors ?? []).filter((a) => a.at).map((a) => [a.mile, (nearestKm(resolveAt(a.at)) - km0) / KM_PER_MILE]);
  const lineMile = makeLineMile(anchors);
  return {
    anchors,
    /** [lat, lon] and downstream compass bearing at a Forest Service river mile. */
    at(mile) {
      const km = km0 + lineMile(mile) * KM_PER_MILE;
      const [lat, lon] = fromEN(pointAt(km));
      const a = pointAt(km - 0.12);
      const b = pointAt(km + 0.12);
      const bearing = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
      return { lat: +lat.toFixed(5), lon: +lon.toFixed(5), bearing: Math.round((bearing + 360) % 360) };
    },
  };
}

/** Where each camp's frame is centred. Pure (no network) — test/campGuide.test.ts checks the manifest against it. */
export function positions(data) {
  const line = centerline(data);
  const ids = campIds(data.camps);
  return Object.fromEntries(data.camps.map((c, i) => [ids[i], line.at(c.m)]));
}

function bboxAround(lat, lon) {
  const dLon = FRAME_KM[0] / 2 / (KM_DEG * Math.cos((lat * Math.PI) / 180));
  const dLat = FRAME_KM[1] / 2 / KM_DEG;
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((v) => v.toFixed(6)).join(",");
}

/** The flight date of the newest real tile under a point (overviews carry no date). */
async function acquisitionDate(lat, lon) {
  const q = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "Year,acquisition_date,Category",
    returnGeometry: "false",
    f: "json",
  });
  const data = await (await fetchRetry(`${IMAGE_SERVER}/query?${q}`)).json();
  const dates = (data.features ?? [])
    .map((f) => f.attributes)
    .filter((a) => a.Category === 1 && a.acquisition_date)
    // The catalog returns epoch milliseconds; older rows are ISO strings.
    .map((a) => (typeof a.acquisition_date === "number" ? new Date(a.acquisition_date).toISOString() : String(a.acquisition_date)).slice(0, 10))
    .sort();
  return dates[dates.length - 1] ?? null;
}

/** Mean of a day's instantaneous values for one parameter, or null. */
async function ivMean(site, param, date) {
  const url = `https://nwis.waterservices.usgs.gov/nwis/iv/?format=json&sites=${site}&parameterCd=${param}&startDT=${date}&endDT=${date}`;
  const data = await (await fetchRetry(url)).json();
  const vals = (data.value?.timeSeries?.[0]?.values?.[0]?.value ?? []).map((v) => Number(v.value)).filter((v) => Number.isFinite(v) && v >= 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/** USGS readings on each flight date: daily mean cfs, and mean feet when the gauge asks for it. */
async function readingsOn(gauge, dates) {
  const out = {};
  for (const date of dates) {
    const dv = `https://waterservices.usgs.gov/nwis/dv/?format=json&sites=${gauge.site}&parameterCd=00060&startDT=${date}&endDT=${date}`;
    let cfs = null;
    try {
      const v = (await (await fetchRetry(dv)).json()).value?.timeSeries?.[0]?.values?.[0]?.value?.[0]?.value;
      cfs = v != null && Number(v) >= 0 ? Number(v) : null;
    } catch {
      cfs = null;
    }
    if (cfs == null) cfs = await ivMean(gauge.site, "00060", date);
    const ft = gauge.stage ? await ivMean(gauge.site, "00065", date) : null;
    out[date] = { cfs: cfs == null ? null : Math.round(cfs), ft: ft == null ? null : +ft.toFixed(2) };
  }
  return out;
}

async function build(slug) {
  const data = JSON.parse(readFileSync(new URL(`scripts/data/${slug}-camps.json`, ROOT), "utf8"));
  const where = positions(data);
  const outDir = new URL(`web/img/camps/${slug}/`, ROOT);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(CACHE, { recursive: true });

  const camps = {};
  const ids = Object.keys(where);
  for (const [i, id] of ids.entries()) {
    const { lat, lon, bearing } = where[id];
    // One camp failing must not lose the other ninety: log it, keep going, and a
    // re-run picks up only what is missing (raw tiles are cached).
    let date;
    try {
      date = await acquisitionDate(lat, lon);
    } catch (err) {
      console.log(`  ${id}: catalog lookup failed (${err.message}), skipped`);
      continue;
    }
    if (!date) {
      console.log(`  ${id}: no dated imagery, skipped`);
      continue;
    }
    const year = date.slice(0, 4);
    const raw = `${CACHE}/${slug}-${id}-${year}.jpg`;
    if (!existsSync(raw)) {
      const q = new URLSearchParams({
        bbox: bboxAround(lat, lon),
        bboxSR: "4326",
        imageSR: "3857",
        size: FETCH_PX.join(","),
        format: "jpg",
        f: "image",
      });
      try {
        const res = await fetchRetry(`${IMAGE_SERVER}/exportImage?${q}`);
        writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
      } catch (err) {
        console.log(`  ${id}: image fetch failed (${err.message}), skipped`);
        continue;
      }
      await sleep(250); // be a polite client of a free public service
    }
    const file = `${id}-aerial-${year}.webp`;
    const out = new URL(file, outDir);
    if (!existsSync(out)) {
      execFileSync("cwebp", ["-quiet", "-q", WEBP_QUALITY, "-resize", String(OUT_PX[0]), String(OUT_PX[1]), raw, "-o", out.pathname]);
    }
    camps[id] = { lat, lon, bearing, date, file };
    process.stdout.write(`  ${String(i + 1).padStart(2)}/${ids.length} ${id} ${date}\n`);
  }

  const gauge = data.gauge ? { site: data.gauge.site, name: data.gauge.name } : null;
  const readings = data.gauge ? await readingsOn(data.gauge, [...new Set(Object.values(camps).map((c) => c.date))]) : {};
  for (const c of Object.values(camps)) {
    c.cfs = readings[c.date]?.cfs ?? null;
    if (data.gauge?.stage) c.ft = readings[c.date]?.ft ?? null;
  }

  const manifest = {
    _readme: [
      "Generated by scripts/build-camp-aerials.mjs — do not edit. One USDA NAIP aerial per camp:",
      "lat/lon is the camp's river mile laid along the OSM centerline and pinned at the camps",
      "file's anchors (good to ~1/4 mile), bearing is the downstream compass direction there,",
      "date is the flight date of the tile, cfs (and ft, where the camp list is in feet) is the",
      "reference gauge on that date.",
    ],
    imagery: { name: "USDA NAIP orthoimagery via USGS The National Map", url: IMAGE_SERVER, license: "Public domain" },
    gauge,
    frameKm: FRAME_KM,
    size: OUT_PX,
    camps,
  };
  writeFileSync(new URL(`scripts/data/${slug}-aerials.json`, ROOT), `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(`${slug}: ${Object.keys(camps).length} aerials, readings ${JSON.stringify(readings)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const slug of process.argv.slice(2).length ? process.argv.slice(2) : ["main-salmon"]) await build(slug);
}
