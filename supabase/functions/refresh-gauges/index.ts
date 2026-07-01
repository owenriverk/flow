import { createClient } from 'jsr:@supabase/supabase-js@2';
import { GAUGES } from './gauges.ts';

const NO_DATA = -999999;

interface Reading {
  discharge: number | null;
  stage: number | null;
  reading_time: string;
}

async function fetchUsgs(site: string): Promise<Reading> {
  const url =
    `https://waterservices.usgs.gov/nwis/iv/?format=json` +
    `&sites=${encodeURIComponent(site)}&parameterCd=00060,00065&siteStatus=all`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return { discharge: null, stage: null, reading_time: new Date().toISOString() };
    // deno-lint-ignore no-explicit-any
    const body = (await res.json()) as any;
    const series: unknown[] = body.value?.timeSeries ?? [];
    let discharge: number | null = null;
    let stage: number | null = null;
    let dt = new Date().toISOString();
    for (const s of series as Array<Record<string, unknown>>) {
      // deno-lint-ignore no-explicit-any
      const code = (s.variable as any)?.variableCode?.[0]?.value as string | undefined;
      // deno-lint-ignore no-explicit-any
      const pt = (s.values as any)?.[0]?.value?.[0] as { value?: string; dateTime?: string } | undefined;
      if (pt?.dateTime) dt = pt.dateTime;
      const n = Number(pt?.value);
      if (Number.isFinite(n) && n !== NO_DATA) {
        if (code === '00060') discharge = n;
        if (code === '00065') stage = n;
      }
    }
    return { discharge, stage, reading_time: dt };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWsc(station: string): Promise<Reading> {
  const url =
    `https://api.weather.gc.ca/collections/hydrometric-realtime/items` +
    `?STATION_NUMBER=${encodeURIComponent(station)}&limit=1&sortby=-DATETIME&f=json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return { discharge: null, stage: null, reading_time: new Date().toISOString() };
    // deno-lint-ignore no-explicit-any
    const body = (await res.json()) as any;
    const props = body.features?.[0]?.properties;
    if (!props) return { discharge: null, stage: null, reading_time: new Date().toISOString() };
    const dt: string = props.DATETIME_LST ?? props.DATETIME ?? new Date().toISOString();
    const d = typeof props.DISCHARGE === 'number' && Number.isFinite(props.DISCHARGE) ? props.DISCHARGE as number : null;
    const s = typeof props.LEVEL === 'number' && Number.isFinite(props.LEVEL) ? props.LEVEL as number : null;
    return { discharge: d, stage: s, reading_time: dt };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNoaa(stationId: string): Promise<Reading> {
  const url = `https://api.water.noaa.gov/nwps/v1/gauges/${encodeURIComponent(stationId)}/stageflow`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return { discharge: null, stage: null, reading_time: new Date().toISOString() };
    // deno-lint-ignore no-explicit-any
    const body = (await res.json()) as any;
    const data = (body?.observed?.data ?? []) as Array<{ validTime?: string; primary?: number }>;
    if (data.length === 0) return { discharge: null, stage: null, reading_time: new Date().toISOString() };
    const last = data[data.length - 1]!;
    const stage = typeof last.primary === 'number' && last.primary > -900 ? last.primary : null;
    return { discharge: null, stage, reading_time: last.validTime ?? new Date().toISOString() };
  } finally {
    clearTimeout(timer);
  }
}

// Null out discharge/stage if the API returns a timestamp older than 48 hours.
// This catches decommissioned stations that return stale historical readings.
const MAX_READING_AGE_MS = 48 * 60 * 60 * 1000;
function withStalenessCheck(r: Reading): Reading {
  const age = Date.now() - new Date(r.reading_time).getTime();
  if (age > MAX_READING_AGE_MS) return { discharge: null, stage: null, reading_time: r.reading_time };
  return r;
}

function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { fields.push(field.trim()); field = ''; }
    else { field += ch; }
  }
  fields.push(field.trim());
  return fields;
}

// Dreamflows zero-pads the id column (e.g. "069"), but our config isn't
// consistently padded (e.g. site: '69') — normalize both sides by stripping
// leading zeros so the lookup matches regardless of padding.
function normalizeDreamflowsId(id: string): string {
  return String(Number(id));
}

async function fetchDreamflowsMap(): Promise<Map<string, string[]>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch('https://www.dreamflows.com/downloads/realtime.csv', { signal: ctrl.signal });
    if (!res.ok) return new Map();
    const text = await res.text();
    const map = new Map<string, string[]>();
    for (const line of text.split('\n').slice(7)) {
      if (!line.trim()) continue;
      const cols = parseCsvRow(line);
      if (cols[0]) map.set(normalizeDreamflowsId(cols[0]), cols);
    }
    return map;
  } catch {
    return new Map();
  } finally {
    clearTimeout(timer);
  }
}

function dreamflowsReading(rows: Map<string, string[]>, riverId: string): Reading {
  const cols = rows.get(normalizeDreamflowsId(riverId));
  if (!cols) return { discharge: null, stage: null, reading_time: new Date().toISOString() };
  const rawFlow = cols[7] ?? '';
  const discharge = Number(rawFlow);
  if (!rawFlow || !Number.isFinite(discharge)) {
    return { discharge: null, stage: null, reading_time: new Date().toISOString() };
  }
  const dateStr = cols[3] ?? '';
  const timeStr = cols[4] ?? '';
  return { discharge, stage: null, reading_time: `${dateStr}T${timeStr}:00-08:00` };
}

async function fetchCdec(station: string, sensor: number, dur: string): Promise<Reading> {
  const end = new Date();
  const start = new Date(end.getTime() - 5 * 86_400_000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const url =
    `https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet` +
    `?Stations=${encodeURIComponent(station)}&SensorNums=${sensor}&dur_code=${dur}` +
    `&Start=${ymd(start)}&End=${ymd(end)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return { discharge: null, stage: null, reading_time: new Date().toISOString() };
    const rows = (await res.json()) as Array<{ value?: number | null; obsDate?: string; units?: string }>;
    if (!Array.isArray(rows) || rows.length === 0) {
      return { discharge: null, stage: null, reading_time: new Date().toISOString() };
    }
    const good = rows.filter(r => typeof r.value === 'number' && r.value > -9998);
    const last = good[good.length - 1];
    if (!last) return { discharge: null, stage: null, reading_time: new Date().toISOString() };
    // "2026-6-27 23:00" (CDEC Pacific local time, unpadded) → ISO with Pacific offset
    const m = (last.obsDate ?? '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
    // CDEC timestamps are Pacific local time (PST in winter, PDT in summer).
    // Determine the current Pacific offset by checking US DST boundaries.
    const pacificOffset = (() => {
      const now = new Date();
      const yr = now.getUTCFullYear();
      // DST starts 2nd Sunday in March at 2am local (10am UTC)
      const dstStart = new Date(Date.UTC(yr, 2, 8 + (7 - new Date(Date.UTC(yr, 2, 8)).getUTCDay()) % 7, 10));
      // DST ends 1st Sunday in November at 2am local (9am UTC)
      const dstEnd = new Date(Date.UTC(yr, 10, 1 + (7 - new Date(Date.UTC(yr, 10, 1)).getUTCDay()) % 7, 9));
      return now >= dstStart && now < dstEnd ? '-07:00' : '-08:00';
    })();
    const dt = m
      ? `${m[1]}-${m[2]!.padStart(2,'0')}-${m[3]!.padStart(2,'0')}T${m[4]!.padStart(2,'0')}:${m[5]}:00${pacificOffset}`
      : new Date().toISOString();
    const isStage = (last.units ?? '').toUpperCase() === 'FEET';
    return {
      discharge: isStage ? null : (last.value ?? null),
      stage:     isStage ? (last.value ?? null) : null,
      reading_time: dt,
    };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async () => {
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Fetch Dreamflows CSV once (25 KB) for all Dreamflows gauges — no need to download per-gauge.
  const hasDreamflows = GAUGES.some(g => g.source === 'dreamflows');
  const dreamflowsMap = hasDreamflows ? await fetchDreamflowsMap() : new Map<string, string[]>();

  // Snapshot current discharge before overwriting it, so the UI can show a trend arrow.
  const { data: existingRows } = await client
    .from('gauges')
    .select('key, discharge, reading_time, prev_discharge');
  const existingByKey = new Map((existingRows ?? []).map(r => [r.key as string, r]));

  const results = await Promise.allSettled(
    GAUGES.map(async (g) => {
      let reading: Reading;
      if (g.source === 'wsc') {
        reading = withStalenessCheck(await fetchWsc(g.site));
      } else if (g.source === 'cdec') {
        reading = withStalenessCheck(await fetchCdec(g.site, g.sensor!, g.dur!));
      } else if (g.source === 'dreamflows') {
        reading = withStalenessCheck(dreamflowsReading(dreamflowsMap, g.site));
      } else if (g.source === 'noaa') {
        reading = withStalenessCheck(await fetchNoaa(g.site));
      } else {
        reading = withStalenessCheck(await fetchUsgs(g.site));
      }

      // Carry the last known discharge forward through null readings, so a brief
      // outage doesn't reset the trend baseline back to "unknown".
      const existing = existingByKey.get(g.key);
      const prevDischarge = existing?.discharge ?? existing?.prev_discharge ?? null;
      const prevReadingTime = existing?.discharge != null ? existing.reading_time : null;

      const { error } = await client.from('gauges').upsert({
        key: g.key,
        name: g.name,
        location: g.location,
        source: g.source,
        site: g.site,
        sensor: g.sensor ?? null,
        dur: g.dur ?? null,
        text_key: g.text_key,
        gauge_url: g.gauge_url,
        low: g.low,
        high: g.high,
        discharge: reading.discharge,
        discharge_unit: g.source === 'wsc' ? 'cms' : 'cfs',
        stage: reading.stage,
        stage_unit: g.source === 'wsc' ? 'm' : 'ft',   // NOAA reports stage in ft
        reading_time: reading.reading_time,
        prev_discharge: prevDischarge,
        prev_reading_time: prevReadingTime,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(`${g.key}: ${error.message}`);
    }),
  );

  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map(r => r.reason instanceof Error ? r.reason.message : String(r.reason));

  // Delete any row whose key is no longer in the canonical GAUGES list, so the table
  // stays exactly in sync with the curated gauge set instead of accumulating rows
  // from earlier revisions forever (existingByKey was snapshotted before this run's
  // upserts, so it only ever contains keys this cycle didn't just (re)write).
  const currentKeys = new Set(GAUGES.map(g => g.key));
  const orphanKeys = [...existingByKey.keys()].filter(k => !currentKeys.has(k));
  if (orphanKeys.length > 0) {
    await client.from('gauges').delete().in('key', orphanKeys);
  }

  return new Response(
    JSON.stringify({ updated: results.length - errors.length, removed: orphanKeys.length, errors }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
