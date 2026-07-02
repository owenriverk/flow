import { describe, expect, it, vi } from 'vitest';
import { buildGarminCheck, GARMIN_STATE_KEY } from '../src/canaryGarmin.js';
import { LAST_TOKEN_KEY } from '../src/canaryHelpers.js';

const NOW = new Date('2026-07-02T14:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const FORM_HTML = `
  <form>
    <input id="MessageId" value="12345">
    <input name="Guid" type="hidden" value="abc-def">
    <input id="ReplyAddress" value="paddler@example.com">
  </form>`;

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

const freshToken = () => JSON.stringify({ token: 'tok-1', receivedAt: hoursAgo(6) });

function deps(over: Record<string, unknown> = {}) {
  return {
    kv: kv({ [LAST_TOKEN_KEY]: freshToken() }),
    fetchFn: vi.fn(async () => new Response(FORM_HTML, { status: 200 })) as unknown as typeof fetch,
    now: () => NOW,
    ...over,
  };
}

describe('garmin form check', () => {
  it('fresh token + parseable form is ok', async () => {
    const result = await buildGarminCheck(deps()).run();
    expect(result.status).toBe('ok');
    expect(result.findings).toEqual([]);
  });

  it('fresh token + 200 + missing fields is THE alert state', async () => {
    const result = await buildGarminCheck(
      deps({ fetchFn: vi.fn(async () => new Response('<html>totally different page</html>', { status: 200 })) }),
    ).run();
    expect(result.status).toBe('findings');
    expect(result.findings).toHaveLength(1);
    expect(result.findings![0]).toContain('MessageId, Guid, ReplyAddress');
  });

  it('a persisting alert goes quiet after the first night; recovery alerts once', async () => {
    const store = kv({ [LAST_TOKEN_KEY]: freshToken() });
    const broken = deps({
      kv: store,
      fetchFn: vi.fn(async () => new Response('<html>nope</html>', { status: 200 })),
    });
    const first = await buildGarminCheck(broken).run();
    expect(first.findings).toHaveLength(1);
    const second = await buildGarminCheck(broken).run();
    expect(second.status).toBe('findings');
    expect(second.findings).toEqual([]);
    expect(store.store[GARMIN_STATE_KEY]).toBe('alert');

    const recovered = await buildGarminCheck(deps({ kv: store })).run();
    expect(recovered.status).toBe('ok');
    expect(recovered.findings).toEqual(['Garmin reply form parses again']);
  });

  it('stale token is unknown, never alerts', async () => {
    const store = kv({
      [LAST_TOKEN_KEY]: JSON.stringify({ token: 'tok-old', receivedAt: hoursAgo(20 * 24) }),
    });
    const fetchFn = vi.fn();
    const result = await buildGarminCheck(deps({ kv: store, fetchFn })).run();
    expect(result.status).toBe('skipped');
    expect(result.summary).toContain('unknown');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('absent token is unknown', async () => {
    const result = await buildGarminCheck(deps({ kv: kv() })).run();
    expect(result.status).toBe('skipped');
    expect(result.summary).toContain('no usable InReach token');
  });

  it('garbled or legacy KV value is unknown', async () => {
    for (const value of ['not-json{', '"plain-old-token-string"', JSON.stringify({ nope: 1 })]) {
      const result = await buildGarminCheck(deps({ kv: kv({ [LAST_TOKEN_KEY]: value }) })).run();
      expect(result.status).toBe('skipped');
    }
  });

  it('non-200 (bot challenge, expiry page) is unknown — a monitor-side block is not proof', async () => {
    for (const status of [403, 404, 503]) {
      const result = await buildGarminCheck(
        deps({ fetchFn: vi.fn(async () => new Response('challenge', { status })) }),
      ).run();
      expect(result.status).toBe('skipped');
      expect(result.summary).toContain(`HTTP ${status}`);
    }
  });

  it('network failure/timeout is unknown', async () => {
    const result = await buildGarminCheck(
      deps({
        fetchFn: vi.fn(async () => {
          throw new Error('socket hang up');
        }),
      }),
    ).run();
    expect(result.status).toBe('skipped');
    expect(result.summary).toContain('socket hang up');
  });
});
