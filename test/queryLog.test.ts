import { describe, expect, test, vi } from 'vitest';
import { logQuery } from '../src/queryLog.js';

describe('logQuery', () => {
  test('POSTs query, resolved, and channel to the query_log REST endpoint', async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(null, { status: 201 }),
    );
    await logQuery('https://x.supabase.co', 'anon-key', 'mf salmon', true, 'inreach', { fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://x.supabase.co/rest/v1/query_log');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).apikey).toBe('anon-key');
    expect(JSON.parse(init?.body as string)).toEqual({
      query: 'mf salmon',
      resolved: true,
      channel: 'inreach',
    });
  });

  test('never throws when the request fails', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('network down');
    });
    await expect(
      logQuery('https://x.supabase.co', 'anon-key', 'stikine', false, 'email', { fetchFn }),
    ).resolves.toBeUndefined();
  });

  test('never throws on a non-2xx response', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 500 }));
    await expect(
      logQuery('https://x.supabase.co', 'anon-key', 'stikine', false, 'none', { fetchFn }),
    ).resolves.toBeUndefined();
  });
});
