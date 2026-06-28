/**
 * Fetch a current reading from Water Survey of Canada via the MSC GeoMet
 * OGC API (api.weather.gc.ca, hydrometric-realtime collection).
 *
 *   GET /collections/hydrometric-realtime/items
 *       ?STATION_NUMBER=<id>&limit=1&sortby=-DATETIME&f=json
 *
 * WSC reports SI units (DISCHARGE m3/s, LEVEL m). We keep them native (cms / m)
 * because Canadian big-water runs are talked about in cms, not cfs. The reading
 * carries its own unit labels so formatReply prints the right ones.
 *
 *   empty features ─▶ not_found    (unknown station id)
 *   4xx ───────────▶ not_found
 *   5xx / timeout ─▶ unavailable
 *   network / parse ▶ unavailable
 */

import type { Reading } from './formatReply.js';
import { GaugeError, type GaugeErrorKind } from './errors.js';
import { parseObserved } from './time.js';

const ENDPOINT = 'https://api.weather.gc.ca/collections/hydrometric-realtime/items';
const DEFAULT_TIMEOUT_MS = 8000;

export class WscError extends GaugeError {
  override name = 'WscError';
  constructor(kind: GaugeErrorKind, message: string) {
    super(kind, message);
  }
}

export interface FetchOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

interface WscProps {
  STATION_NAME?: string;
  DISCHARGE?: number | null;
  LEVEL?: number | null;
  DATETIME?: string; // UTC, e.g. "2026-06-28T01:40:00Z"
  DATETIME_LST?: string; // local standard time w/ offset, e.g. "2026-06-27T17:40:00-08:00"
}

/** A finite number, else undefined (covers null/missing/NaN sensor values). */
function num(v: number | null | undefined): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export async function fetchReading(
  stationId: string,
  opts: FetchOptions = {},
): Promise<Reading> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url =
    `${ENDPOINT}?STATION_NUMBER=${encodeURIComponent(stationId)}` +
    `&limit=1&sortby=-DATETIME&f=json`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetchFn(url, { signal: ctrl.signal });
  } catch (e) {
    throw new WscError('unavailable', `request failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 400 || res.status === 404) {
    throw new WscError('not_found', `no such station: ${stationId}`);
  }
  if (!res.ok) {
    throw new WscError('unavailable', `WSC returned ${res.status}`);
  }

  let body: { features?: Array<{ properties?: WscProps }> };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new WscError('unavailable', 'WSC returned non-JSON');
  }

  const props = body.features?.[0]?.properties;
  if (!props) {
    throw new WscError('not_found', `no current data for ${stationId}`);
  }

  // DATETIME_LST carries the station's local offset; DATETIME is UTC-only.
  const dt = props.DATETIME_LST ?? props.DATETIME ?? new Date().toISOString();
  const { observedAt, offsetMinutes } = parseObserved(dt);

  return {
    discharge: num(props.DISCHARGE),
    stage: num(props.LEVEL),
    dischargeUnit: 'cms',
    stageUnit: 'm',
    usgsName: props.STATION_NAME,
    observedAt,
    offsetMinutes,
  };
}
