/**
 * Fire-and-forget log of every inbound query to Supabase's `query_log` table --
 * lets us see what rivers people are actually asking for (including ones that
 * don't resolve) without waiting on Cloudflare Workers Logs' short retention.
 *
 * Never throws: a broken log write must never affect whether the paddler gets
 * their reply, so every failure mode (network, non-2xx, timeout) is swallowed.
 */

export type QueryChannel = 'inreach' | 'email' | 'none';

export interface QueryLogDeps {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export async function logQuery(
  supabaseUrl: string,
  anonKey: string,
  query: string,
  resolved: boolean,
  channel: QueryChannel,
  deps: QueryLogDeps = {},
): Promise<void> {
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 5000;
  try {
    await fetchFn(`${supabaseUrl}/rest/v1/query_log`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ query, resolved, channel }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // best-effort only -- see module docstring
  }
}
