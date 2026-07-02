import { describe, expect, it, vi } from 'vitest';
import {
  runNightlyChecks,
  RUNNER_KEY,
  type CheckResult,
  type NightlyCheck,
  type RunnerSnapshot,
} from '../src/canaryRunner.js';

function kv(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    store,
    get: vi.fn(async (k: string) => store[k] ?? null),
    put: vi.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
  };
}

const ok = (summary = 'all good'): CheckResult => ({ status: 'ok', summary });

function deps(over: Partial<{ kv: ReturnType<typeof kv>; notify: ReturnType<typeof vi.fn> }> = {}) {
  return {
    kv: over.kv ?? kv(),
    notify: over.notify ?? vi.fn(async () => {}),
    now: () => new Date('2026-07-02T14:00:00Z'),
  };
}

function snapshotFrom(store: Record<string, string>): RunnerSnapshot {
  return JSON.parse(store[RUNNER_KEY] ?? 'null') as RunnerSnapshot;
}

describe('runNightlyChecks', () => {
  it('a throwing check becomes status error and later checks still run', async () => {
    const ran: string[] = [];
    const checks: NightlyCheck[] = [
      {
        name: 'boom',
        run: async () => {
          ran.push('boom');
          throw new Error('kaput');
        },
      },
      {
        name: 'after',
        run: async () => {
          ran.push('after');
          return ok();
        },
      },
    ];
    const d = deps();
    const results = await runNightlyChecks(checks, d);
    expect(ran).toEqual(['boom', 'after']);
    expect(results.boom).toEqual({ status: 'error', summary: 'kaput' });
    expect(results.after!.status).toBe('ok');
  });

  it('writes the KV snapshot incrementally — earlier results survive a later crash', async () => {
    const store = kv();
    let midRunSnapshot: RunnerSnapshot | null = null;
    const checks: NightlyCheck[] = [
      { name: 'first', run: async () => ok('first done') },
      {
        name: 'second',
        run: async () => {
          // At this point the runner must already have persisted `first`.
          midRunSnapshot = snapshotFrom(store.store);
          throw new Error('dies mid-run');
        },
      },
    ];
    await runNightlyChecks(checks, deps({ kv: store }));
    expect(midRunSnapshot).not.toBeNull();
    expect(midRunSnapshot!.checks.first).toMatchObject({ status: 'ok', summary: 'first done' });
    const final = snapshotFrom(store.store);
    expect(final.checks.second!.status).toBe('error');
    expect(final.lastRunAt).toBe('2026-07-02T14:00:00.000Z');
  });

  it('emails findings from checks, prefixed with the check name', async () => {
    const notify = vi.fn(async () => {});
    const checks: NightlyCheck[] = [
      {
        name: 'sweep',
        run: async () => ({
          status: 'findings' as const,
          summary: '1 gauge offline',
          findings: ['gauley (usgs:03189100): ok -> offline'],
        }),
      },
    ];
    await runNightlyChecks(checks, deps({ notify }));
    expect(notify).toHaveBeenCalledTimes(1);
    const [subject, text] = notify.mock.calls[0] as unknown as [string, string];
    expect(subject).toContain('1 item(s)');
    expect(text).toContain('[sweep] gauley (usgs:03189100): ok -> offline');
  });

  it('sends no email when every check is ok with no findings', async () => {
    const notify = vi.fn(async () => {});
    await runNightlyChecks(
      [
        { name: 'a', run: async () => ok() },
        { name: 'b', run: async () => ({ status: 'skipped' as const, summary: 'no token' }) },
      ],
      deps({ notify }),
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it('alerts on a NEW error but not on a persisting one', async () => {
    const store = kv();
    const notify = vi.fn(async () => {});
    const failing: NightlyCheck[] = [
      {
        name: 'sweep',
        run: async () => {
          throw new Error('supabase down');
        },
      },
    ];
    await runNightlyChecks(failing, deps({ kv: store, notify }));
    expect(notify).toHaveBeenCalledTimes(1);

    // Next night: same failure, same KV — no second page.
    await runNightlyChecks(failing, deps({ kv: store, notify }));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('fails open on KV errors: checks still run and findings still email', async () => {
    const brokenKv = {
      get: vi.fn(async () => {
        throw new Error('kv get down');
      }),
      put: vi.fn(async () => {
        throw new Error('kv put down');
      }),
    };
    const notify = vi.fn(async () => {});
    const results = await runNightlyChecks(
      [
        {
          name: 'sweep',
          run: async () => ({ status: 'findings' as const, summary: 's', findings: ['x'] }),
        },
      ],
      { kv: brokenKv, notify, now: () => new Date('2026-07-02T14:00:00Z') },
    );
    expect(results.sweep!.status).toBe('findings');
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('swallows notify failures', async () => {
    const notify = vi.fn(async () => {
      throw new Error('smtp down');
    });
    await expect(
      runNightlyChecks(
        [{ name: 'a', run: async () => ({ status: 'findings' as const, summary: 's', findings: ['x'] }) }],
        deps({ notify }),
      ),
    ).resolves.toBeTruthy();
  });

  it('preserves results of checks not run tonight (snapshot merge)', async () => {
    const prior: RunnerSnapshot = {
      lastRunAt: '2026-07-01T14:00:00.000Z',
      checks: { garmin: { status: 'skipped', summary: 'stale token', at: '2026-07-01T14:00:00.000Z' } },
    };
    const store = kv({ [RUNNER_KEY]: JSON.stringify(prior) });
    await runNightlyChecks([{ name: 'sweep', run: async () => ok() }], deps({ kv: store }));
    const final = snapshotFrom(store.store);
    expect(final.checks.garmin!.status).toBe('skipped');
    expect(final.checks.sweep!.status).toBe('ok');
  });
});
