/**
 * Pure, tested helpers behind the two one-line canary hooks in worker.ts's
 * email handler. Kept out of the (deliberately untested) Worker adapter so the
 * logic has unit tests and the adapter stays a thin shell.
 *
 * cacheInboundToken — every real InReach message carries a fresh per-message
 * reply token; caching `{token, receivedAt}` lets the nightly Garmin form
 * check (src/canaryGarmin.ts) GET a real token page instead of having nothing
 * to look at. Fire-and-forget: a KV hiccup must never touch the reply path.
 *
 * isCanaryMessage — identifies the GitHub Action's nightly synthetic email so
 * its telemetry lands on the 'canary' channel, not in real paddler stats.
 * From headers are spoofable and both the address and this repo are public,
 * so the subject must ALSO carry a shared secret ("[canary:<secret>]",
 * mirrored between an Actions secret and a Worker secret). Unconfigured or
 * missing secret → treated as ordinary traffic.
 */

import type { KvLike } from './budget.js';

export const LAST_TOKEN_KEY = 'status:inreach:last_token';

export interface CachedToken {
  token: string;
  receivedAt: string;
}

export async function cacheInboundToken(
  kv: KvLike,
  token: string | null,
  now: Date = new Date(),
): Promise<void> {
  if (!token) return;
  try {
    const cached: CachedToken = { token, receivedAt: now.toISOString() };
    await kv.put(LAST_TOKEN_KEY, JSON.stringify(cached));
  } catch {
    // fire-and-forget — never let token caching affect the reply
  }
}

export function canarySubjectMarker(secret: string): string {
  return `[canary:${secret}]`;
}

export function isCanaryMessage(
  from: string,
  subject: string,
  canaryFrom: string | undefined,
  canarySecret: string | undefined,
): boolean {
  if (!canaryFrom || !canarySecret) return false;
  if (from.trim().toLowerCase() !== canaryFrom.trim().toLowerCase()) return false;
  return subject.includes(canarySubjectMarker(canarySecret));
}
