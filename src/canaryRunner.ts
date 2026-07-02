/**
 * Nightly self-check runner — the thin dispatcher the Worker's scheduled()
 * handler calls. Individual checks (gauge sweep, Garmin form, canary watchdog)
 * live in their own modules and are registered by the Worker.
 *
 *   scheduled() ─▶ runNightlyChecks(checks, deps)
 *                    ├─ for each check, IN ISOLATION:
 *                    │    run() ─▶ CheckResult      (a throw becomes status 'error')
 *                    │    write KV snapshot immediately (incremental — a later
 *                    │    crash cannot erase an earlier check's result)
 *                    └─ one email at most per night, via deps.notify
 *
 * Alerting contract (keeps the owner inbox quiet — see DESIGN "alert fatigue"):
 *   - `findings` on a CheckResult are NEW, alertable items only. Checks that
 *     watch standing conditions (e.g. a gauge offline all winter) must
 *     transition-filter their own findings; the runner emails whatever it gets.
 *   - `status` is the STANDING state for the status page and may repeat night
 *     after night without emailing.
 *   - a check newly entering 'error' (vs the previous run) is emailed once;
 *     a check that stays in 'error' does not re-email.
 *
 * Everything here fails open: a KV hiccup must never stop the remaining checks
 * or the findings email, and a notify failure must never look like a check
 * failure.
 */

import type { KvLike } from './budget.js';

export type CheckStatus = 'ok' | 'findings' | 'error' | 'skipped';

export interface CheckResult {
  status: CheckStatus;
  /** One line of standing state for the status page. */
  summary: string;
  /** NEW alertable items only — drives the nightly email. */
  findings?: string[];
}

export interface NightlyCheck {
  name: string;
  run: () => Promise<CheckResult>;
}

export interface RunnerDeps {
  kv: KvLike;
  notify: (subject: string, text: string) => Promise<void>;
  now?: () => Date;
}

export interface RunnerSnapshot {
  lastRunAt: string;
  checks: Record<string, { status: CheckStatus; summary: string; at: string }>;
}

export const RUNNER_KEY = 'canary:results';

async function readSnapshot(kv: KvLike): Promise<RunnerSnapshot | null> {
  try {
    const raw = await kv.get(RUNNER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RunnerSnapshot;
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.checks !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function runNightlyChecks(
  checks: NightlyCheck[],
  deps: RunnerDeps,
): Promise<Record<string, CheckResult>> {
  const now = deps.now ?? (() => new Date());
  const previous = await readSnapshot(deps.kv);

  const snapshot: RunnerSnapshot = {
    lastRunAt: now().toISOString(),
    checks: { ...(previous?.checks ?? {}) },
  };
  const results: Record<string, CheckResult> = {};
  const alertLines: string[] = [];

  for (const check of checks) {
    let result: CheckResult;
    try {
      result = await check.run();
    } catch (err) {
      result = {
        status: 'error',
        summary: err instanceof Error ? err.message : String(err),
      };
    }
    results[check.name] = result;

    for (const finding of result.findings ?? []) {
      alertLines.push(`[${check.name}] ${finding}`);
    }
    // Entering 'error' alerts once; staying in 'error' does not re-page.
    if (result.status === 'error' && previous?.checks[check.name]?.status !== 'error') {
      alertLines.push(`[${check.name}] check errored: ${result.summary}`);
    }

    snapshot.checks[check.name] = {
      status: result.status,
      summary: result.summary,
      at: now().toISOString(),
    };
    try {
      await deps.kv.put(RUNNER_KEY, JSON.stringify(snapshot));
    } catch {
      // fail open — a stale status page beats a skipped check
    }
  }

  if (alertLines.length > 0) {
    const subject = `[LateBoof] Nightly self-check: ${alertLines.length} item(s)`;
    const text = [
      'The nightly self-check found the following:',
      '',
      ...alertLines,
      '',
      'Standing state: lateboof.com/status',
    ].join('\n');
    await deps.notify(subject, text).catch(() => {
      // notify failures must not look like check failures
    });
  }

  return results;
}
