/**
 * Pure trend-baseline logic for the gauge directory's arrows — no Deno APIs,
 * no network, so it runs under both the edge runtime and vitest (imported
 * from test/trend.test.ts the same way nameConsistency.test.ts imports
 * gauges.ts).
 *
 * The pipeline per cron tick (wired in index.ts):
 *
 *   reading ──historyRow()──▶ flow_history append   (skip null discharge)
 *                                   │
 *   window [now-30h, now-18h] ──────┤
 *                                   ▼
 *   pickBaseline(rows, now) ──▶ { baseline_discharge, baseline_reading_time }
 *                                   │  (nearest to now-24h, ±6h tolerance,
 *                                   ▼   nulls when nothing qualifies)
 *   gauges upsert payload — fields ALWAYS present (eng-review Issue 1A:
 *   explicit over PostgREST column-merge cleverness)
 *
 * Why 24h: a 6–12h window measures the diurnal melt cycle (morning reading vs
 * evening peak reads "dropping" on a river that is coming in day-over-day).
 * Same-time-of-day comparison cancels the cycle.
 */

export const BASELINE_TARGET_HOURS = 24;
export const BASELINE_TOLERANCE_HOURS = 6;
export const HISTORY_RETENTION_HOURS = 48;

const HOUR_MS = 3_600_000;

export interface HistoryRow {
  key: string;
  discharge: number;
  reading_time: string;
}

export interface BaselineFields {
  baseline_discharge: number | null;
  baseline_reading_time: string | null;
}

export interface ReadingLike {
  discharge: number | null;
  reading_time: string | null;
}

/**
 * The flow_history row for this tick's reading, or null when there is nothing
 * trustworthy to record (no discharge — stage-only NOAA gauges never enter
 * history — or no timestamp, or an unparseable timestamp).
 */
export function historyRow(key: string, reading: ReadingLike): HistoryRow | null {
  if (reading.discharge == null || reading.reading_time == null) return null;
  if (!Number.isFinite(Date.parse(reading.reading_time))) return null;
  return { key, discharge: reading.discharge, reading_time: reading.reading_time };
}

/**
 * The reading nearest to `now - 24h`, accepted only within ±6h of the target.
 * Returns explicit nulls otherwise — an absent arrow is honest; a fabricated
 * baseline is not. Rows with unparseable timestamps are ignored. On a distance
 * tie, the older row wins (deterministic, and a slightly wider window errs
 * toward the trend, not the diurnal cycle).
 */
export function pickBaseline(rows: HistoryRow[], now: Date): BaselineFields {
  const target = now.getTime() - BASELINE_TARGET_HOURS * HOUR_MS;
  const tolerance = BASELINE_TOLERANCE_HOURS * HOUR_MS;

  let best: HistoryRow | null = null;
  let bestDistance = Infinity;
  for (const row of rows) {
    const t = Date.parse(row.reading_time);
    if (!Number.isFinite(t)) continue;
    const distance = Math.abs(t - target);
    if (distance > tolerance) continue;
    if (
      distance < bestDistance ||
      (distance === bestDistance && best !== null && t < Date.parse(best.reading_time))
    ) {
      best = row;
      bestDistance = distance;
    }
  }

  return best === null
    ? { baseline_discharge: null, baseline_reading_time: null }
    : { baseline_discharge: best.discharge, baseline_reading_time: best.reading_time };
}

/** Window bounds for the single history query that serves every gauge's pick. */
export function baselineWindow(now: Date): { from: string; to: string } {
  const target = now.getTime() - BASELINE_TARGET_HOURS * HOUR_MS;
  const tolerance = BASELINE_TOLERANCE_HOURS * HOUR_MS;
  return {
    from: new Date(target - tolerance).toISOString(),
    to: new Date(target + tolerance).toISOString(),
  };
}

/** Cutoff before which flow_history rows are deleted each run. */
export function retentionCutoff(now: Date): string {
  return new Date(now.getTime() - HISTORY_RETENTION_HOURS * HOUR_MS).toISOString();
}
