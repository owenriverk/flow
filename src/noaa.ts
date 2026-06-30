import { GaugeError } from './errors.js';
import type { Reading } from './formatReply.js';

export class NoaaError extends GaugeError {}

export async function fetchReading(stationId: string): Promise<Reading> {
  const url = `https://api.water.noaa.gov/nwps/v1/gauges/${encodeURIComponent(stationId)}/stageflow`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new NoaaError('unavailable');
    // deno-lint-ignore no-explicit-any
    const body = (await res.json()) as any;
    const data = (body?.observed?.data ?? []) as Array<{ validTime?: string; primary?: number }>;
    if (data.length === 0) throw new NoaaError('unavailable');
    const last = data[data.length - 1]!;
    const stageVal = typeof last.primary === 'number' && last.primary > -900 ? last.primary : null;
    if (stageVal === null) throw new NoaaError('unavailable');
    const observedAt = last.validTime ? new Date(last.validTime) : new Date();
    return { stage: stageVal, stageUnit: 'ft', observedAt, offsetMinutes: 0 };
  } catch (e) {
    if (e instanceof GaugeError) throw e;
    throw new NoaaError('unavailable');
  } finally {
    clearTimeout(timer);
  }
}
