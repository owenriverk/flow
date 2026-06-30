/**
 * Fetch the last cached gauge reading from Supabase when the live API is unavailable.
 * Returns null if the row is missing, the request fails, or there's no reading_time.
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
    select: 'discharge,stage,discharge_unit,stage_unit,reading_time',
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
    }>;
    const row = rows[0];
    if (!row?.reading_time) return null;
    return {
      discharge: row.discharge ?? undefined,
      stage: row.stage ?? undefined,
      dischargeUnit: (row.discharge_unit as 'cfs' | 'cms') ?? 'cfs',
      stageUnit: (row.stage_unit as 'ft' | 'm') ?? 'ft',
      observedAt: new Date(row.reading_time),
      offsetMinutes: 0,
    };
  } catch {
    return null;
  }
}
