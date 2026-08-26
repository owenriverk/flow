/**
 * Nightly Garmin reply-page check — CORROBORATING signal only (see the design
 * doc's honest coverage statement: nothing automated exercises the actual send).
 *
 * Uses the reply token cached from the most recent real InReach message
 * (src/canaryHelpers.ts cacheInboundToken) to GET the inreachlink reply page and
 * run EXACTLY the discovery the reply path runs (src/replyToInreach.ts
 * locateReplyAction): find the page's script chunks and the Server Action id
 * registered as "sendReplyAction". Never invokes the action — we don't spam
 * Garmin's unofficial endpoint. This is what caught the 2026-08 move from
 * explore.garmin.com's HTML form to messenger.garmin.com the morning after.
 *
 * Heavily biased toward 'unknown' (reported as status 'skipped'), because a
 * false alarm here trains the owner to ignore the one alert that matters:
 *   - no token cached yet, or the KV value is garbled       → unknown
 *   - token older than the expiry horizon                   → unknown
 *   - network error, timeout, non-200 page, script chunk
 *     that fails to load (a Workers-egress block on the
 *     MONITOR is not proof the page changed)                → unknown
 * The ONLY alerting state: a fresh token, an HTTP 200 page whose scripts all
 * load, and no reply action in any of them (InreachReplyError kind 'format').
 * Alerts on the transition only.
 */

import type { KvLike } from './budget.js';
import type { CheckResult, NightlyCheck } from './canaryRunner.js';
import { LAST_TOKEN_KEY, type CachedToken } from './canaryHelpers.js';
import { InreachReplyError, locateReplyAction, REPLY_ACTION_NAME } from './replyToInreach.js';

export const GARMIN_STATE_KEY = 'canary:garmin:state';

export interface GarminDeps {
  kv: KvLike;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
  /** Tokens older than this are 'unknown'. Default 14 days — refine with the
   *  horizon The Assignment measures (see the v1.5 design doc). */
  maxTokenAgeHours?: number;
}

function unknown(reason: string): CheckResult {
  return { status: 'skipped', summary: `unknown: ${reason}` };
}

async function readToken(kv: KvLike): Promise<CachedToken | null> {
  try {
    const raw = await kv.get(LAST_TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedToken;
    if (typeof parsed?.token !== 'string' || typeof parsed?.receivedAt !== 'string') return null;
    return parsed;
  } catch {
    // absent, pre-{token,receivedAt} legacy value, or KV hiccup — all unknown
    return null;
  }
}

export function buildGarminCheck(deps: GarminDeps): NightlyCheck {
  return {
    name: 'garmin form',
    run: async (): Promise<CheckResult> => {
      const fetchFn = deps.fetchFn ?? fetch;
      const timeoutMs = deps.timeoutMs ?? 10_000;
      const now = (deps.now ?? (() => new Date()))();
      const maxAgeHours = deps.maxTokenAgeHours ?? 14 * 24;

      const cached = await readToken(deps.kv);
      if (!cached) return unknown('no usable InReach token cached');

      const ageHours = (now.getTime() - Date.parse(cached.receivedAt)) / 3_600_000;
      if (!Number.isFinite(ageHours) || ageHours > maxAgeHours) {
        return unknown(`token is ${Math.round(ageHours / 24)}d old (limit ${maxAgeHours / 24}d)`);
      }

      const tokenUrl = `https://inreachlink.com/${encodeURIComponent(cached.token)}`;
      let res: Response;
      let html: string;
      try {
        res = await fetchFn(tokenUrl, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) return unknown(`reply page returned HTTP ${res.status}`);
        html = await res.text();
      } catch (err) {
        return unknown(`reply page unreachable: ${err instanceof Error ? err.message : String(err)}`);
      }

      // The reply path's own discovery. 'format' is the one state that means the
      // page changed; anything else is the monitor failing to see, not Garmin.
      let problem: string | null = null;
      try {
        await locateReplyAction(html, res.url || tokenUrl, { fetchFn, timeoutMs });
      } catch (err) {
        if (err instanceof InreachReplyError && err.kind === 'format') {
          problem = err.message;
        } else {
          return unknown(`page scripts unreachable: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Transition-only alerting, like the watchdog.
      let prevState: string | null = null;
      try {
        prevState = await deps.kv.get(GARMIN_STATE_KEY);
      } catch {
        // fail open
      }
      try {
        await deps.kv.put(GARMIN_STATE_KEY, problem ? 'alert' : 'ok');
      } catch {
        // fail open
      }

      if (problem) {
        const findings =
          prevState === 'alert'
            ? []
            : [
                `Garmin reply page (fresh token, HTTP 200): ${problem}. ` +
                  'Either Garmin changed the page (src/replyToInreach.ts needs an update) or ' +
                  'this is bot-mitigation serving the monitor a stripped page — try the URL ' +
                  'from a browser before acting.',
              ];
        return {
          status: 'findings',
          summary: `reply page missing ${REPLY_ACTION_NAME}`,
          findings,
        };
      }
      return {
        status: 'ok',
        summary: `reply action found (token ${Math.max(0, Math.round(ageHours))}h old)`,
        findings: prevState === 'alert' ? ['Garmin reply page parses again'] : [],
      };
    },
  };
}
