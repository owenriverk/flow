/**
 * Nightly Garmin form check — CORROBORATING signal only (see the design doc's
 * honest coverage statement: nothing automated exercises the actual POST).
 *
 * Uses the reply token cached from the most recent real InReach message
 * (src/canaryHelpers.ts cacheInboundToken) to GET the inreachlink reply page
 * and assert the three fields the reply path scrapes are still there. Never
 * POSTs — we don't spam Garmin's unofficial endpoint.
 *
 * Heavily biased toward 'unknown' (reported as status 'skipped'), because a
 * false alarm here trains the owner to ignore the one alert that matters:
 *   - no token cached yet, or the KV value is garbled       → unknown
 *   - token older than the expiry horizon                   → unknown
 *   - network error, timeout, non-200, bot-challenge page   → unknown
 *     (a Workers-egress IP block on the MONITOR is not proof the form changed)
 * The ONLY alerting state: a fresh token, an HTTP 200 page, and any of
 * MessageId / Guid / ReplyAddress missing from it — parsed with the exact
 * scrapeField the real reply path uses. Alerts on the transition only.
 */

import type { KvLike } from './budget.js';
import type { CheckResult, NightlyCheck } from './canaryRunner.js';
import { LAST_TOKEN_KEY, type CachedToken } from './canaryHelpers.js';
import { scrapeField } from './replyToInreach.js';

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
      const now = (deps.now ?? (() => new Date()))();
      const maxAgeHours = deps.maxTokenAgeHours ?? 14 * 24;

      const cached = await readToken(deps.kv);
      if (!cached) return unknown('no usable InReach token cached');

      const ageHours = (now.getTime() - Date.parse(cached.receivedAt)) / 3_600_000;
      if (!Number.isFinite(ageHours) || ageHours > maxAgeHours) {
        return unknown(`token is ${Math.round(ageHours / 24)}d old (limit ${maxAgeHours / 24}d)`);
      }

      let res: Response;
      let html: string;
      try {
        res = await fetchFn(`https://inreachlink.com/${encodeURIComponent(cached.token)}`, {
          redirect: 'follow',
          signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
        });
        if (!res.ok) return unknown(`reply page returned HTTP ${res.status}`);
        html = await res.text();
      } catch (err) {
        return unknown(`reply page unreachable: ${err instanceof Error ? err.message : String(err)}`);
      }

      const missing = ['MessageId', 'Guid', 'ReplyAddress'].filter(
        (field) => scrapeField(html, field) === null,
      );

      // Transition-only alerting, like the watchdog.
      let prevState: string | null = null;
      try {
        prevState = await deps.kv.get(GARMIN_STATE_KEY);
      } catch {
        // fail open
      }
      try {
        await deps.kv.put(GARMIN_STATE_KEY, missing.length > 0 ? 'alert' : 'ok');
      } catch {
        // fail open
      }

      if (missing.length > 0) {
        const findings =
          prevState === 'alert'
            ? []
            : [
                `Garmin reply page (fresh token, HTTP 200) is missing: ${missing.join(', ')}. ` +
                  'Either Garmin changed the form (src/replyToInreach.ts needs an update) or ' +
                  'this is bot-mitigation serving the monitor a stripped page — try the URL ' +
                  'from a browser before acting.',
              ];
        return {
          status: 'findings',
          summary: `reply form missing ${missing.join(', ')}`,
          findings,
        };
      }
      return {
        status: 'ok',
        summary: `reply form parses (token ${Math.max(0, Math.round(ageHours))}h old)`,
        findings: prevState === 'alert' ? ['Garmin reply form parses again'] : [],
      };
    },
  };
}
