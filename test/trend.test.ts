/**
 * Unit tests for the pure trend-baseline logic (refresh-gauges/trend.ts).
 * Every branch from the eng-review coverage diagram — this is the exact
 * logic class whose previous incarnation (prev_* overwritten every tick)
 * shipped broken because nothing tested it.
 */
import { describe, expect, it } from 'vitest';
import {
  BASELINE_TARGET_HOURS,
  BASELINE_TOLERANCE_HOURS,
  HISTORY_RETENTION_HOURS,
  baselineWindow,
  historyRow,
  pickBaseline,
  retentionCutoff,
} from '../supabase/functions/refresh-gauges/trend.js';

const NOW = new Date('2026-07-06T18:00:00Z');
const HOUR_MS = 3_600_000;

/** A history row whose reading is `hoursAgo` hours before NOW. */
function row(hoursAgo: number, discharge = 100, key = 'kings') {
  return {
    key,
    discharge,
    reading_time: new Date(NOW.getTime() - hoursAgo * HOUR_MS).toISOString(),
  };
}

describe('historyRow', () => {
  it('records a good reading', () => {
    expect(historyRow('kings', { discharge: 662, reading_time: '2026-07-06T17:00:00Z' }))
      .toEqual({ key: 'kings', discharge: 662, reading_time: '2026-07-06T17:00:00Z' });
  });

  it('skips stage-only readings (NOAA gauges never enter history)', () => {
    expect(historyRow('animas', { discharge: null, reading_time: '2026-07-06T17:00:00Z' }))
      .toBeNull();
  });

  it('skips readings with no timestamp', () => {
    expect(historyRow('kings', { discharge: 662, reading_time: null })).toBeNull();
  });

  it('skips readings with an unparseable timestamp', () => {
    expect(historyRow('kings', { discharge: 662, reading_time: 'not a date' })).toBeNull();
  });
});

describe('pickBaseline', () => {
  it('returns nulls on empty history (first ~24h after deploy)', () => {
    expect(pickBaseline([], NOW))
      .toEqual({ baseline_discharge: null, baseline_reading_time: null });
  });

  it('picks an exact 24h-ago reading', () => {
    const exact = row(24, 850);
    const picked = pickBaseline([row(30, 1), exact, row(18.5, 2)], NOW);
    expect(picked.baseline_discharge).toBe(850);
    expect(picked.baseline_reading_time).toBe(exact.reading_time);
  });

  it('picks the row NEAREST to 24h when none is exact', () => {
    const nearest = row(22.5, 777);
    expect(pickBaseline([row(29, 1), nearest, row(18.5, 2)], NOW).baseline_discharge).toBe(777);
  });

  it('accepts a reading exactly at the ±6h tolerance boundary', () => {
    const boundary = row(BASELINE_TARGET_HOURS + BASELINE_TOLERANCE_HOURS, 555);
    expect(pickBaseline([boundary], NOW).baseline_discharge).toBe(555);
  });

  it('returns nulls when everything is outside tolerance (sparse source)', () => {
    // 17h ago and 31h ago are both >6h from the 24h target.
    expect(pickBaseline([row(17), row(31)], NOW))
      .toEqual({ baseline_discharge: null, baseline_reading_time: null });
  });

  it('breaks a distance tie toward the OLDER reading', () => {
    const older = row(25, 300); // 1h past target
    const newer = row(23, 400); // 1h short of target
    expect(pickBaseline([newer, older], NOW).baseline_discharge).toBe(300);
    expect(pickBaseline([older, newer], NOW).baseline_discharge).toBe(300); // order-independent
  });

  it('ignores rows with unparseable timestamps instead of crashing', () => {
    const good = row(24, 850);
    const bad = { key: 'kings', discharge: 1, reading_time: 'garbage' };
    expect(pickBaseline([bad, good], NOW).baseline_discharge).toBe(850);
  });
});

describe('window + retention bounds', () => {
  it('baselineWindow spans [now-30h, now-18h]', () => {
    const { from, to } = baselineWindow(NOW);
    expect(from).toBe(new Date(NOW.getTime() - 30 * HOUR_MS).toISOString());
    expect(to).toBe(new Date(NOW.getTime() - 18 * HOUR_MS).toISOString());
  });

  it('every row inside baselineWindow is safe from the retention delete', () => {
    // Guards the two constants against drifting into an order where the
    // retention sweep eats tomorrow's baseline candidates.
    expect(HISTORY_RETENTION_HOURS).toBeGreaterThanOrEqual(
      BASELINE_TARGET_HOURS + BASELINE_TOLERANCE_HOURS,
    );
    const cutoff = Date.parse(retentionCutoff(NOW));
    expect(cutoff).toBeLessThanOrEqual(Date.parse(baselineWindow(NOW).from));
  });
});
