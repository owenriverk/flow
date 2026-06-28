/**
 * Fetch a current reading from the California Data Exchange Center (CDEC),
 * the source for most California class V flows (USGS doesn't carry them).
 *
 *   GET /dynamicapp/req/JSONDataServlet
 *       ?Stations=<code>&SensorNums=<n>&dur_code=<H|D|E>&Start=..&End=..
 *
 * CDEC is already in cfs/ft (no conversion). Quirks handled here:
 *   - records carry value + units; -9999 is the missing-data sentinel
 *   - obsDate is Pacific wall-clock with no zone ("2026-6-27 23:00"); CDEC
 *     stores PST year-round, so we pin it to -08:00
 *   - the flow sensor varies by station, so the caller passes `sensor`
 *     (20 = river flow, 76 = reservoir inflow, 1 = stage)
 *
 *   empty array ───▶ not_found    (unknown/blank station)
 *   all -9999 ─────▶ unavailable  (station exists but no recent reading)
 *   4xx ───────────▶ not_found
 *   5xx / timeout ─▶ unavailable
 */

import type { Reading } from './formatReply.js';
import { GaugeError, type GaugeErrorKind } from './errors.js';
import { parseObserved } from './time.js';

const ENDPOINT = 'https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet';
const MISSING = -9998; // CDEC uses -9999; anything <= this is "no data"
const DEFAULT_SENSOR = 20; // river discharge, CFS
const DEFAULT_DUR = 'H'; // hourly
const DEFAULT_TIMEOUT_MS = 8000;
const LOOKBACK_DAYS = 5;

export class CdecError extends GaugeError {
  override name = 'CdecError';
  constructor(kind: GaugeErrorKind, message: string) {
    super(kind, message);
  }
}

export interface FetchOptions {
  sensor?: number;
  dur?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

interface CdecRecord {
  value?: number | null;
  units?: string;
  obsDate?: string;
  date?: string;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "2026-6-27 23:00" (Pacific, unpadded) -> "2026-06-27T23:00:00-08:00". */
function cdecToIso(raw: string): string {
  const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return raw;
  const [, y, mo, d, h, mi] = m;
  const p = (s: string) => s.padStart(2, '0');
  return `${y}-${p(mo!)}-${p(d!)}T${p(h!)}:${mi}:00-08:00`;
}

export async function fetchReading(station: string, opts: FetchOptions = {}): Promise<Reading> {
  const fetchFn = opts.fetchFn ?? fetch;
  const sensor = opts.sensor ?? DEFAULT_SENSOR;
  const dur = opts.dur ?? DEFAULT_DUR;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const end = new Date();
  const start = new Date(end.getTime() - LOOKBACK_DAYS * 86_400_000);
  const url =
    `${ENDPOINT}?Stations=${encodeURIComponent(station)}` +
    `&SensorNums=${sensor}&dur_code=${dur}&Start=${ymd(start)}&End=${ymd(end)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetchFn(url, { signal: ctrl.signal });
  } catch (e) {
    throw new CdecError('unavailable', `request failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 400 || res.status === 404) {
    throw new CdecError('not_found', `no such station: ${station}`);
  }
  if (!res.ok) {
    throw new CdecError('unavailable', `CDEC returned ${res.status}`);
  }

  let rows: CdecRecord[];
  try {
    rows = (await res.json()) as CdecRecord[];
  } catch {
    throw new CdecError('unavailable', 'CDEC returned non-JSON');
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new CdecError('not_found', `no such station: ${station}`);
  }

  const good = rows.filter(
    (r) => typeof r.value === 'number' && Number.isFinite(r.value) && r.value > MISSING,
  );
  const last = good[good.length - 1];
  if (!last || last.value == null) {
    throw new CdecError('unavailable', `no recent reading for ${station}`);
  }

  const dt = last.obsDate ?? last.date ?? new Date().toISOString();
  const { observedAt, offsetMinutes } = parseObserved(cdecToIso(dt));
  const isStage = (last.units ?? '').toUpperCase() === 'FEET';

  return {
    discharge: isStage ? undefined : last.value,
    stage: isStage ? last.value : undefined,
    dischargeUnit: 'cfs',
    stageUnit: 'ft',
    observedAt,
    offsetMinutes,
  };
}
