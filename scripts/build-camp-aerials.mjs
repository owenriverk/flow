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
 * lays mile x 1.609 km along the same OSM centerline the maps use, measured from
 * the put-in. Checked against surveyed creek mouths that is good to about a
 * quarter mile, so the frame is 1.2 km wide and the caption says the camp is
 * somewhere near the middle rather than pretending to pinpoint the tent sites.
 *
 * What water level: whatever the day of the flight was. Each tile's acquisition
 * date comes from the image service's catalog, and the USGS daily mean at the
 * river's reference gauge for that date is recorded beside it, so the caption
 * can say "25 Sep 2021, 2,900 cfs" instead of guessing "low water".
 *
 * Sources:
 *   imagery  https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer
 *   flow     https://waterservices.usgs.gov/nwis/dv/ (daily mean discharge, 00060)
 *
 * Raw JPEGs are cached in node_modules/.cache/camp-aerials, so a re-run only
 * fetches what is missing. Needs `cwebp` on PATH.
 *
 * Run: node scripts/build-camp-aerials.mjs [slug]        (default: main-salmon)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
/**
 * Forest Service mile -> mile along the OSM centerline. The OSM line runs a
 * little long: surveyed creek mouths sit 0.15-0.3 mile further down it than the
 * camps the Forest Service lists at those creeks (Chamberlain, Bargamin, Big
 * Mallard, South Fork — measured 2026-09-30). Piecewise-linear between these
 * anchors, and the last offset carries on below the last one.
 */
const CALIBRATION = {
  "main-salmon": [
    [0, 0],
    [15.4, 15.62],
    [32.0, 32.12],
    [36.9, 37.2],
    [56.5, 56.66],
  ],
};
function lineMile(slug, mile) {
  const pts = CALIBRATION[slug];
  if (!pts) return mile;
  for (let i = 1; i < pts.length; i += 1) {
    const [m0, l0] = pts[i - 1];
    const [m1, l1] = pts[i];
    if (mile <= m1) return l0 + ((l1 - l0) * (mile - m0)) / (m1 - m0);
  }
  const [mLast, lLast] = pts[pts.length - 1];
  return mile + (lLast - mLast);
}
/** Reference gauge per river, for "what was the flow on the day of the flight". */
const GAUGE = { "main-salmon": { site: "13317000", name: "White Bird" } };

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

/** The river as [lat, lon] with km measured from the put-in, plus lookups. */
function centerline(slug) {
  const cfg = RIVERS.find((r) => r.slug === slug);
  if (!cfg) throw new Error(`no river config for ${slug} in build-river-sides.mjs`);
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
  return {
    /** [lat, lon] and downstream compass bearing at a river mile. */
    at(mile) {
      const km = km0 + lineMile(slug, mile) * KM_PER_MILE;
      const [lat, lon] = fromEN(pointAt(km));
      const a = pointAt(km - 0.12);
      const b = pointAt(km + 0.12);
      const bearing = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
      return { lat, lon, bearing: Math.round((bearing + 360) % 360) };
    },
  };
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

/** USGS daily mean discharge, cfs, for a set of dates at one gauge. */
async function flowsOn(site, dates) {
  const out = {};
  for (const date of dates) {
    const url = `https://waterservices.usgs.gov/nwis/dv/?format=json&sites=${site}&parameterCd=00060&startDT=${date}&endDT=${date}`;
    const data = await (await fetchRetry(url)).json();
    const v = data.value?.timeSeries?.[0]?.values?.[0]?.value?.[0]?.value;
    out[date] = v != null && Number(v) >= 0 ? Math.round(Number(v)) : null;
  }
  return out;
}

async function build(slug) {
  const data = JSON.parse(readFileSync(new URL(`scripts/data/${slug}-camps.json`, ROOT), "utf8"));
  const ids = campIds(data.camps);
  const line = centerline(slug);
  const outDir = new URL(`web/img/camps/${slug}/`, ROOT);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(CACHE, { recursive: true });

  const camps = {};
  for (const [i, camp] of data.camps.entries()) {
    const id = ids[i];
    const { lat, lon, bearing } = line.at(camp.m);
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
    camps[id] = { lat: +lat.toFixed(5), lon: +lon.toFixed(5), bearing, date, file };
    process.stdout.write(`  ${String(i + 1).padStart(2)}/${data.camps.length} ${id} ${date}\n`);
  }

  const gauge = GAUGE[slug];
  const flows = gauge ? await flowsOn(gauge.site, [...new Set(Object.values(camps).map((c) => c.date))]) : {};
  for (const c of Object.values(camps)) c.cfs = flows[c.date] ?? null;

  const manifest = {
    _readme: [
      "Generated by scripts/build-camp-aerials.mjs — do not edit. One USDA NAIP aerial per camp:",
      "lat/lon is the camp's river mile laid along the OSM centerline (good to ~1/4 mile),",
      "bearing is the downstream compass direction there, date is the flight date of the",
      "tile, cfs is the USGS daily mean at the reference gauge on that date.",
    ],
    imagery: { name: "USDA NAIP orthoimagery via USGS The National Map", url: IMAGE_SERVER, license: "Public domain" },
    gauge: gauge ?? null,
    frameKm: FRAME_KM,
    size: OUT_PX,
    camps,
  };
  writeFileSync(new URL(`scripts/data/${slug}-aerials.json`, ROOT), `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(`${slug}: ${Object.keys(camps).length} aerials, flows ${JSON.stringify(flows)}`);
}

for (const slug of process.argv.slice(2).length ? process.argv.slice(2) : ["main-salmon"]) await build(slug);
