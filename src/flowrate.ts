/**
 * Fetch a current flow reading from flowrate.co.nz, a paddler-run aggregator
 * of New Zealand river telemetry.
 *
 *   GET https://flowrate.co.nz/station/<id>/json/flow/current
 *
 * `id` is flowrate's own numeric station id (e.g. "61" for Haast River —
 * Roaring Billy), found by inspecting the network requests a river's page
 * makes -- there's no public site-name search, so this source is raw-id-only
 * via curated aliases.json entries, same as Dreamflows.
 *
 * An unknown station id returns the JSON literal `false` with HTTP 200 (no
 * distinct 404), which is the not_found signal. Timestamps are bare NZ local
 * wall-clock ("2026-07-03 14:15:00", no zone) -- pinned to NZST (+12:00)
 * year-round, same tradeoff as src/envdata.ts and src/dreamflows.ts. Units
 * are native m3/sec (cms), confirmed against the page's own "Cumecs (m³/s)"
 * label.
 *
 *   body === false ────────────▶ not_found
 *   4xx / 5xx ──────────────────▶ unavailable
 *   network / timeout / parse ──▶ unavailable
 */

import type { Reading } from './formatReply.js';
import { GaugeError, type GaugeErrorKind } from './errors.js';
import { parseObserved } from './time.js';

const DEFAULT_TIMEOUT_MS = 8000;
const NZST_SUFFIX = '+12:00'; // see file header

export class FlowrateError extends GaugeError {
  override name = 'FlowrateError';
  constructor(kind: GaugeErrorKind, message: string) {
    super(kind, message);
  }
}

export interface FetchOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

interface FlowrateCurrent {
  timestamp?: string; // "2026-07-03 14:15:00", NZ local, no zone
  value?: number;
}

export async function fetchReading(stationId: string, opts: FetchOptions = {}): Promise<Reading> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `https://flowrate.co.nz/station/${encodeURIComponent(stationId)}/json/flow/current`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetchFn(url, { signal: ctrl.signal });
  } catch (e) {
    throw new FlowrateError('unavailable', `request failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new FlowrateError('unavailable', `flowrate returned ${res.status}`);
  }

  let body: FlowrateCurrent | false;
  try {
    body = (await res.json()) as FlowrateCurrent | false;
  } catch {
    throw new FlowrateError('unavailable', 'flowrate returned non-JSON');
  }

  if (body === false) {
    throw new FlowrateError('not_found', `no such flowrate station: ${stationId}`);
  }

  const value = body.value;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new FlowrateError('unavailable', 'bad reading value');
  }
  if (!body.timestamp) {
    throw new FlowrateError('unavailable', 'missing timestamp');
  }

  const { observedAt, offsetMinutes } = parseObserved(
    `${body.timestamp.replace(' ', 'T')}${NZST_SUFFIX}`,
  );

  return {
    discharge: value,
    dischargeUnit: 'cms',
    observedAt,
    offsetMinutes,
  };
}
