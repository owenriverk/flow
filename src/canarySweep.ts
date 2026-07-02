/**
 * Nightly gauge-data sweep + email-canary watchdog — two NightlyChecks for
 * src/canaryRunner.ts.
 *
 * SWEEP: reads the website's `gauges` table (already refreshed every 15 min by
 * the Supabase cron — this module fetches nothing upstream) and classifies each
 * gauge:
 *
 *   offline  — discharge AND stage are null (the refresher nulls readings it
 *              can't trust, so this also covers upstream 48h-stale data)
 *   stale    — reading_time missing or older than the per-source budget
 *   flatline — reading_time identical to last night's sweep (station frozen;
 *              only reachable for sources whose budget outlasts one sweep gap)
 *   ok       — none of the above
 *
 * Alerting is TRANSITION-ONLY: a gauge that goes offline for the whole winter
 * emails once when it transitions (and once when it recovers), never nightly.
 * The standing state lives in the runner's KV blob → /api/status → status.html.
 * First-ever sweep records a baseline and alerts nothing.
 *
 * WATCHDOG: asserts the GitHub-Actions email canary actually ran — GitHub
 * auto-disables scheduled workflows on quiet public repos after ~60 days, and
 * nothing emails you about runs that never happen. Calls the narrow
 * canary_last_seen() RPC (migration 008; returns ONE timestamp, no query text)
 * and alerts on the fresh→stale transition only.
 */

import type { KvLike } from './budget.js';
import type { CheckResult, NightlyCheck } from './canaryRunner.js';

export const SWEEP_KEY = 'canary:sweep:snapshot';
export const WATCHDOG_STATE_KEY = 'canary:watchdog:state';

export type GaugeState = 'ok' | 'offline' | 'stale' | 'flatline';

/** Hours a reading may lag before the sweep calls it stale. WSC/NOAA/Dreamflows
 *  report slowly or on scrape cadence; USGS/CDEC are near-real-time. */
const STALENESS_BUDGET_HOURS: Record<string, number> = {
  usgs: 24,
  cdec: 24,
  wsc: 48,
  noaa: 48,
  dreamflows: 48,
};
const DEFAULT_BUDGET_HOURS = 48;

interface GaugeRow {
  key: string;
  source: string;
  site: string;
  discharge: number | null;
  stage: number | null;
  reading_time: string | null;
}

export interface SweepSnapshot {
  gauges: Record<string, { state: GaugeState; readingTime: string | null }>;
}

export interface SweepDeps {
  supabaseUrl: string;
  anonKey: string;
  kv: KvLike;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}

function classify(row: GaugeRow, prevReadingTime: string | null | undefined, now: Date): GaugeState {
  if (row.discharge === null && row.stage === null) return 'offline';
  const budget = STALENESS_BUDGET_HOURS[row.source] ?? DEFAULT_BUDGET_HOURS;
  if (row.reading_time === null) return 'stale';
  const ageHours = (now.getTime() - Date.parse(row.reading_time)) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours > budget) return 'stale';
  if (prevReadingTime !== undefined && prevReadingTime === row.reading_time) return 'flatline';
  return 'ok';
}

async function readJsonKey<T>(kv: KvLike, key: string): Promise<T | null> {
  try {
    const raw = await kv.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function writeJsonKey(kv: KvLike, key: string, value: unknown): Promise<void> {
  try {
    await kv.put(key, JSON.stringify(value));
  } catch {
    // fail open — a stale snapshot means a repeat alert at worst, never a lost sweep
  }
}

export function buildSweepCheck(deps: SweepDeps): NightlyCheck {
  return {
    name: 'gauge sweep',
    run: async (): Promise<CheckResult> => {
      const fetchFn = deps.fetchFn ?? fetch;
      const now = (deps.now ?? (() => new Date()))();

      let rows: GaugeRow[];
      try {
        const res = await fetchFn(
          `${deps.supabaseUrl}/rest/v1/gauges?select=key,source,site,discharge,stage,reading_time`,
          {
            headers: { apikey: deps.anonKey, Authorization: `Bearer ${deps.anonKey}` },
            signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
          },
        );
        if (!res.ok) {
          return { status: 'error', summary: `gauges read failed: HTTP ${res.status}` };
        }
        rows = (await res.json()) as GaugeRow[];
      } catch (err) {
        return {
          status: 'error',
          summary: `gauges read failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      const previous = await readJsonKey<SweepSnapshot>(deps.kv, SWEEP_KEY);
      const next: SweepSnapshot = { gauges: {} };
      const findings: string[] = [];
      const counts: Record<GaugeState, number> = { ok: 0, offline: 0, stale: 0, flatline: 0 };

      for (const row of rows) {
        const id = `${row.source}:${row.site}`;
        const prev = previous?.gauges[id];
        const state = classify(row, prev?.readingTime, now);
        counts[state] += 1;
        next.gauges[id] = { state, readingTime: row.reading_time };

        // Transition-only alerting. First-ever sweep (no snapshot) is a silent
        // baseline; a gauge newly appearing in a later sweep counts as 'ok' before.
        if (previous !== null) {
          const before = prev?.state ?? 'ok';
          if (before !== state) {
            const at = row.reading_time ? ` (last reading ${row.reading_time})` : '';
            findings.push(`${row.key} (${id}): ${before} -> ${state}${at}`);
          }
        }
      }

      await writeJsonKey(deps.kv, SWEEP_KEY, next);

      const issues = counts.offline + counts.stale + counts.flatline;
      const summary =
        `${rows.length} gauges: ${counts.ok} ok` +
        (issues > 0
          ? `, ${counts.offline} offline, ${counts.stale} stale, ${counts.flatline} flatline`
          : '');
      return { status: issues > 0 ? 'findings' : 'ok', summary, findings };
    },
  };
}

export interface WatchdogDeps {
  supabaseUrl: string;
  anonKey: string;
  kv: KvLike;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
  maxAgeHours?: number;
}

export function buildWatchdogCheck(deps: WatchdogDeps): NightlyCheck {
  return {
    name: 'email-canary watchdog',
    run: async (): Promise<CheckResult> => {
      const fetchFn = deps.fetchFn ?? fetch;
      const now = (deps.now ?? (() => new Date()))();
      const maxAgeHours = deps.maxAgeHours ?? 48;

      let lastSeen: string | null;
      try {
        const res = await fetchFn(`${deps.supabaseUrl}/rest/v1/rpc/canary_last_seen`, {
          method: 'POST',
          headers: {
            apikey: deps.anonKey,
            Authorization: `Bearer ${deps.anonKey}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
          signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
        });
        if (res.status === 404) {
          return { status: 'skipped', summary: 'canary_last_seen() not installed (migration 008)' };
        }
        if (!res.ok) {
          return { status: 'error', summary: `canary_last_seen failed: HTTP ${res.status}` };
        }
        lastSeen = (await res.json()) as string | null;
      } catch (err) {
        return {
          status: 'error',
          summary: `canary_last_seen failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      if (lastSeen === null) {
        return { status: 'skipped', summary: 'no canary messages logged yet' };
      }

      const ageHours = (now.getTime() - Date.parse(lastSeen)) / 3_600_000;
      const stale = !Number.isFinite(ageHours) || ageHours > maxAgeHours;

      // Transition-only alerting, tracked in its own tiny KV key.
      let prevState: string | null = null;
      try {
        prevState = await deps.kv.get(WATCHDOG_STATE_KEY);
      } catch {
        // fail open — worst case a repeat alert
      }
      try {
        await deps.kv.put(WATCHDOG_STATE_KEY, stale ? 'stale' : 'ok');
      } catch {
        // fail open
      }

      if (stale) {
        const findings =
          prevState === 'stale'
            ? []
            : [
                `email canary has not run in ${Math.round(ageHours)}h — GitHub may have ` +
                  'auto-disabled the scheduled workflow (quiet repo) or its secrets broke. ' +
                  'Check the Actions tab.',
              ];
        return {
          status: 'findings',
          summary: `email canary last ran ${Math.round(ageHours)}h ago (limit ${maxAgeHours}h)`,
          findings,
        };
      }
      const recovered = prevState === 'stale';
      return {
        status: 'ok',
        summary: `email canary last ran ${Math.max(0, Math.round(ageHours))}h ago`,
        findings: recovered ? ['email canary is running again'] : [],
      };
    },
  };
}
