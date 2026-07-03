/**
 * Fetch a current flow reading from Environment Southland's envdata telemetry
 * system (New Zealand).
 *
 *   GET https://envdata.es.govt.nz/services/data.ashx?s=<site name>&m=Flow&i=7
 *
 * The site "id" this API understands is the exact human-readable station name
 * (there is no separate numeric code) -- e.g. "Wairaurahiri at Lake Hauroko".
 * `i=7` requests the last 7 days of hourly data; we only use the final point
 * as the current reading. Response is always HTTP 200, even for an unknown
 * site name, which comes back with `data: null` -- there's no distinct 404 to
 * key off, so any missing/empty series is treated as unavailable rather than
 * not_found (this source has no raw-id lookup path anyway; every call here
 * originates from a curated aliases.json entry, so a bad name is a config
 * bug, not user input).
 *
 * Data points are `[epochMs, value]` pairs -- an absolute instant, so there's
 * no local-offset ambiguity to parse. Units are native m3/sec (cms); NZ is
 * NZST (+12:00) most of the year, shifting to NZDT (+13:00) late Sep-early
 * Apr. We pin the display offset to NZST year-round -- same tradeoff
 * dreamflows.ts makes for Pacific time: the flow value is what a paddler acts
 * on, and being off by an hour on the displayed clock time in NZ summer is
 * an acceptable cost for not needing a DST calendar.
 *
 *   data: null / empty series ─▶ unavailable
 *   network / 4xx / 5xx ───────▶ unavailable
 *   malformed JSON ────────────▶ unavailable
 */

import type { Reading } from './formatReply.js';
import { GaugeError, type GaugeErrorKind } from './errors.js';

const ENDPOINT = 'https://envdata.es.govt.nz/services/data.ashx';
const DEFAULT_TIMEOUT_MS = 8000;
const NZST_OFFSET_MINUTES = 720; // +12:00, see file header

export class EnvdataError extends GaugeError {
  override name = 'EnvdataError';
  constructor(kind: GaugeErrorKind, message: string) {
    super(kind, message);
  }
}

export interface FetchOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

interface EnvdataMeasurement {
  measurement?: string;
  units?: string | null;
  data?: Array<[number, number]> | null;
}

interface EnvdataBody {
  name?: string;
  data?: EnvdataMeasurement[];
}

export async function fetchReading(siteName: string, opts: FetchOptions = {}): Promise<Reading> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${ENDPOINT}?s=${encodeURIComponent(siteName)}&m=Flow&i=7`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetchFn(url, { signal: ctrl.signal });
  } catch (e) {
    throw new EnvdataError('unavailable', `request failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new EnvdataError('unavailable', `envdata returned ${res.status}`);
  }

  let body: EnvdataBody;
  try {
    body = (await res.json()) as EnvdataBody;
  } catch {
    throw new EnvdataError('unavailable', 'envdata returned non-JSON');
  }

  const flow = body.data?.find((m) => m.measurement === 'Flow') ?? body.data?.[0];
  const series = flow?.data;
  if (!series || series.length === 0) {
    throw new EnvdataError('unavailable', `no Flow data for site "${siteName}"`);
  }

  const [epochMs, value] = series[series.length - 1]!;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new EnvdataError('unavailable', 'bad reading value');
  }

  return {
    discharge: value,
    dischargeUnit: 'cms',
    observedAt: new Date(epochMs),
    offsetMinutes: NZST_OFFSET_MINUTES,
    usgsName: body.name,
  };
}
