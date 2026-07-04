/**
 * Fetch the last cached gauge reading from Supabase when the live API is unavailable.
 * The cron carries the last non-null discharge forward as prev_discharge/
 * prev_reading_time, so a gauge that went dark mid-outage still has a "last
 * good" value here — fall back to that pair when the current discharge is null.
 * Returns null if the row is missing, the request fails, or there is no usable
 * value at all (a data-free "cached" reply would just be noise).
 */

import type { Reading } from './formatReply.js';

export async function fetchCachedReading(
  supabaseUrl: string,
  anonKey: string,
  source: string,
  site: string,
): Promise<Reading | null> {
  const params = new URLSearchParams({
    source: `eq.${source}`,
    site: `eq.${site}`,
    select: 'discharge,stage,discharge_unit,stage_unit,reading_time,prev_discharge,prev_reading_time',
    limit: '1',
  });
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/gauges?${params}`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{
      discharge: number | null;
      stage: number | null;
      discharge_unit: string | null;
      stage_unit: string | null;
      reading_time: string | null;
      prev_discharge: number | null;
      prev_reading_time: string | null;
    }>;
    const row = rows[0];
    if (!row) return null;

    const usePrev = row.discharge == null && row.prev_discharge != null;
    const discharge = usePrev ? row.prev_discharge : row.discharge;
    const readingTime = usePrev ? row.prev_reading_time : row.reading_time;
    if (!readingTime) return null;
    if (discharge == null && row.stage == null) return null;

    return {
      discharge: discharge ?? undefined,
      stage: row.stage ?? undefined,
      dischargeUnit: (row.discharge_unit as 'cfs' | 'cms') ?? 'cfs',
      stageUnit: (row.stage_unit as 'ft' | 'm') ?? 'ft',
      observedAt: new Date(readingTime),
      offsetMinutes: 0,
    };
  } catch {
    return null;
  }
}
