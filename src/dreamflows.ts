/**
 * Fetch a current flow reading from Dreamflows for California and Nevada rivers.
 *
 *   GET https://www.dreamflows.com/downloads/realtime.csv
 *
 * Dreamflows publishes a single bulk CSV (~25 KB, updated every 30–60 min)
 * covering all their virtual and direct gauges. We skip the 7-line header,
 * split on newlines, and search for our RiverId.
 *
 * CSV columns (0-indexed, double-quoted strings where needed):
 *   0:RiverId  1:RiverName  2:PlaceName  3:Date  4:Time
 *   5:Confidence  6:Deviation  7:RiverFlow  8:FlowUnit  ...  14:ColorCode
 *
 * RiverFlow is a numeric cfs value when the gauge is reporting; text values
 * ("Low", "BRT", "Unkn", etc.) mean the underlying station can't produce a
 * number right now.
 *
 * Timestamps in the CSV are Pacific wall-clock with no zone annotation; we
 * pin to -08:00 (PST) matching the CDEC convention — display time may be
 * 1 hour behind in summer, which is acceptable since the flow value is what
 * a paddler acts on.
 *
 *   no matching row   ──▶ not_found
 *   non-numeric flow  ──▶ unavailable
 *   network / 4xx/5xx ──▶ unavailable
 */

import type { Reading } from './formatReply.js';
import { GaugeError, type GaugeErrorKind } from './errors.js';
import { parseObserved } from './time.js';

const CSV_URL = 'https://www.dreamflows.com/downloads/realtime.csv';
const HEADER_LINES = 7;
const DEFAULT_TIMEOUT_MS = 8000;

export class DreamflowsError extends GaugeError {
  override name = 'DreamflowsError';
  constructor(kind: GaugeErrorKind, message: string) {
    super(kind, message);
  }
}

export interface FetchOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/** Parse one CSV line, respecting double-quoted fields that may contain commas. */
function parseRow(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

export async function fetchReading(riverId: string, opts: FetchOptions = {}): Promise<Reading> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetchFn(CSV_URL, { signal: ctrl.signal });
  } catch (e) {
    throw new DreamflowsError('unavailable', `request failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new DreamflowsError('unavailable', `Dreamflows returned ${res.status}`);
  }

  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    throw new DreamflowsError('unavailable', `failed to read response: ${(e as Error).message}`);
  }

  const lines = text.split('\n').slice(HEADER_LINES);

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseRow(line);
    if (cols[0] !== riverId) continue;

    const rawFlow = cols[7] ?? '';
    const discharge = Number(rawFlow);
    if (!rawFlow || !Number.isFinite(discharge)) {
      throw new DreamflowsError(
        'unavailable',
        `no numeric reading for Dreamflows gauge ${riverId}: "${rawFlow}"`,
      );
    }

    const dateStr = cols[3] ?? '';
    const timeStr = cols[4] ?? '';
    const { observedAt, offsetMinutes } = parseObserved(`${dateStr}T${timeStr}:00-08:00`);

    return { discharge, dischargeUnit: 'cfs', observedAt, offsetMinutes };
  }

  throw new DreamflowsError('not_found', `Dreamflows gauge ${riverId} not found in CSV`);
}
