/**
 * Fetch a current reading from the USGS Instantaneous Values API.
 *
 *   GET waterservices.usgs.gov/nwis/iv/?format=json
 *       &sites=<id>&parameterCd=00060,00065&siteStatus=all
 *
 * Returns a Reading on success. Throws UsgsError on failure, tagged so the
 * caller can tell a bad gauge id (not_found) from an outage (unavailable) and
 * send the right reply over the satellite link:
 *
 *   400 ─────────────▶ not_found    "not found — check the id"
 *   5xx / timeout ───▶ unavailable  "couldn't reach gauge data, try again"
 *   network / parse ─▶ unavailable
 */

import type { Reading } from './formatReply.js';
import { GaugeError, type GaugeErrorKind } from './errors.js';
import { parseObserved } from './time.js';

export type { Reading };

const ENDPOINT = 'https://waterservices.usgs.gov/nwis/iv/';
const DISCHARGE = '00060';
const STAGE = '00065';
const NO_DATA = -999999;
const DEFAULT_TIMEOUT_MS = 8000;

export class UsgsError extends GaugeError {
  override name = 'UsgsError';
  constructor(kind: GaugeErrorKind, message: string) {
    super(kind, message);
  }
}

export interface FetchOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

interface IvValue {
  value?: Array<{ value?: string; dateTime?: string }>;
}
interface IvSeries {
  sourceInfo?: { siteName?: string };
  variable?: { variableCode?: Array<{ value?: string }> };
  values?: IvValue[];
}

function latest(series: IvSeries): { value?: string; dateTime?: string } | undefined {
  return series.values?.[0]?.value?.[0];
}

function numeric(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n === NO_DATA) return undefined;
  return n;
}

export async function fetchReading(
  siteId: string,
  opts: FetchOptions = {},
): Promise<Reading> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url =
    `${ENDPOINT}?format=json&sites=${encodeURIComponent(siteId)}` +
    `&parameterCd=${DISCHARGE},${STAGE}&siteStatus=all`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetchFn(url, { signal: ctrl.signal });
  } catch (e) {
    throw new UsgsError('unavailable', `request failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 400 || res.status === 404) {
    throw new UsgsError('not_found', `no such gauge: ${siteId}`);
  }
  if (!res.ok) {
    throw new UsgsError('unavailable', `USGS returned ${res.status}`);
  }

  let body: { value?: { timeSeries?: IvSeries[] } };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new UsgsError('unavailable', 'USGS returned non-JSON');
  }

  const seriesList = body.value?.timeSeries ?? [];
  let discharge: number | undefined;
  let stage: number | undefined;
  let usgsName: string | undefined;
  let observed: { value?: string; dateTime?: string } | undefined;

  for (const series of seriesList) {
    const code = series.variable?.variableCode?.[0]?.value;
    const point = latest(series);
    usgsName ??= series.sourceInfo?.siteName;
    if (point?.dateTime) observed ??= point;
    if (code === DISCHARGE) discharge = numeric(point?.value);
    if (code === STAGE) stage = numeric(point?.value);
  }

  const dt = observed?.dateTime ?? new Date().toISOString();
  const { observedAt, offsetMinutes } = parseObserved(dt);
  return { discharge, stage, dischargeUnit: 'cfs', stageUnit: 'ft', usgsName, observedAt, offsetMinutes };
}
