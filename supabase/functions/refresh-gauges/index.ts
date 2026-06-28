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
    // "2026-6-27 23:00" (CDEC PST, unpadded) → ISO with -08:00
    const m = (last.obsDate ?? '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
    const dt = m
      ? `${m[1]}-${m[2]!.padStart(2,'0')}-${m[3]!.padStart(2,'0')}T${m[4]!.padStart(2,'0')}:${m[5]}:00-08:00`
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

  const results = await Promise.allSettled(
    GAUGES.map(async (g) => {
      let reading: Reading;
      if (g.source === 'wsc') {
        reading = await fetchWsc(g.site);
      } else if (g.source === 'cdec') {
        reading = await fetchCdec(g.site, g.sensor!, g.dur!);
      } else {
        reading = await fetchUsgs(g.site);
      }

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
        stage_unit: g.source === 'wsc' ? 'm' : 'ft',
        reading_time: reading.reading_time,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(`${g.key}: ${error.message}`);
    }),
  );

  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map(r => r.reason as string);

  return new Response(
    JSON.stringify({ updated: results.length - errors.length, errors }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
