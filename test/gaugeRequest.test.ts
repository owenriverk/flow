import { describe, expect, it, vi } from 'vitest';
import aliasesJson from '../src/aliases.json' with { type: 'json' };
import type { KvLike } from '../src/budget.js';
import type { GaugeAlias } from '../src/lookupGauge.js';
import {
  DAILY_CAP,
  PER_VISITOR_DAILY_CAP,
  REQUEST_MAX,
  handleGaugeRequest,
  parseGaugeRequest,
  rosterNote,
  type GaugeRequestDeps,
} from '../src/gaugeRequest.js';

const aliases = aliasesJson as Record<string, GaugeAlias>;
const NOW = new Date('2026-10-01T01:02:00Z');

function memoryKv(): KvLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    put: async (key, value) => void store.set(key, value),
  };
}

function makeDeps(overrides: Partial<GaugeRequestDeps> = {}) {
  const notify = vi.fn(async (_subject: string, _text: string) => {});
  const kv = memoryKv();
  const deps: GaugeRequestDeps = {
    kv,
    aliases,
    notify,
    visitorKey: async (ip) => `v-${ip}`,
    now: () => NOW,
    ...overrides,
  };
  return { deps, notify, kv };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://lateboof.com/api/request', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://lateboof.com',
      'CF-Connecting-IP': '203.0.113.7',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const read = async (res: Response) => (await res.json()) as { ok: boolean; message: string };

describe('parseGaugeRequest', () => {
  it('collapses whitespace and newlines so the text is safe in an email subject', () => {
    const parsed = parseGaugeRequest({ request: '  Dean \r\nRiver\tBC\u0000 ' });
    expect(parsed).toEqual({ ok: true, request: 'Dean River BC', bot: false });
  });

  it('rejects empty, too-short, non-string and oversized requests', () => {
    expect(parseGaugeRequest({ request: ' a ' }).ok).toBe(false);
    expect(parseGaugeRequest({ request: 42 }).ok).toBe(false);
    expect(parseGaugeRequest({}).ok).toBe(false);
    expect(parseGaugeRequest(null).ok).toBe(false);
    expect(parseGaugeRequest({ request: 'x'.repeat(REQUEST_MAX + 1) }).ok).toBe(false);
  });

  it('flags a filled honeypot as a bot', () => {
    expect(parseGaugeRequest({ request: 'Dean River', website: 'http://spam.example' })).toMatchObject({ bot: true });
  });
});

describe('rosterNote', () => {
  it('says when the run is already on the roster, and under what name', () => {
    expect(rosterNote('homathko', aliases)).toContain('Already resolves to: Homathko (wsc 08GD004)');
  });

  it('says when the bot would answer "not found"', () => {
    expect(rosterNote('Dean River', aliases)).toContain('Not on the roster');
  });

  it('recognises a raw gauge id', () => {
    expect(rosterNote('12345678', aliases)).toContain('raw USGS gauge ID (12345678)');
  });
});

describe('handleGaugeRequest', () => {
  it('emails the owner once with the request and the roster check', async () => {
    const { deps, notify } = makeDeps();
    const res = await handleGaugeRequest(post({ request: 'Dean River' }), deps);

    expect(res.status).toBe(200);
    expect((await read(res)).ok).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    const [subject, text] = notify.mock.calls[0]!;
    expect(subject).toBe('LateBoof request: Dean River');
    expect(text).toContain('  Dean River');
    expect(text).toContain('Not on the roster');
    expect(text).toContain('2026-10-01 01:02 UTC');
    expect(text).toContain(`Requests today: 1 of ${DAILY_CAP}`);
  });

  it('answers a honeypot hit like a success but sends nothing and counts nothing', async () => {
    const { deps, notify, kv } = makeDeps();
    const res = await handleGaugeRequest(post({ request: 'Dean River', website: 'x' }), deps);

    expect(res.status).toBe(200);
    expect(notify).not.toHaveBeenCalled();
    expect(kv.store.size).toBe(0);
  });

  it('refuses anything that is not a JSON POST from lateboof.com', async () => {
    const { deps, notify } = makeDeps();
    const get = new Request('https://lateboof.com/api/request', { headers: { Origin: 'https://lateboof.com' } });
    expect((await handleGaugeRequest(get, deps)).status).toBe(405);
    expect((await handleGaugeRequest(post({ request: 'Dean River' }, { Origin: 'https://evil.example' }), deps)).status).toBe(403);
    expect((await handleGaugeRequest(post('request=Dean', { 'Content-Type': 'application/x-www-form-urlencoded' }), deps)).status).toBe(415);
    expect((await handleGaugeRequest(post('{not json'), deps)).status).toBe(400);
    expect((await handleGaugeRequest(post({ request: 'a' }), deps)).status).toBe(400);
    expect(notify).not.toHaveBeenCalled();
  });

  it('caps one visitor without touching another', async () => {
    const { deps, notify } = makeDeps();
    for (let i = 0; i < PER_VISITOR_DAILY_CAP; i++) {
      expect((await handleGaugeRequest(post({ request: `Run ${i} please` }), deps)).status).toBe(200);
    }
    expect((await handleGaugeRequest(post({ request: 'one more' }), deps)).status).toBe(429);
    expect(notify).toHaveBeenCalledTimes(PER_VISITOR_DAILY_CAP);

    const other = post({ request: 'Dean River' }, { 'CF-Connecting-IP': '198.51.100.9' });
    expect((await handleGaugeRequest(other, deps)).status).toBe(200);
  });

  it('stops at the global daily cap no matter how many visitors ask', async () => {
    const { deps, notify, kv } = makeDeps();
    kv.store.set('req:day:2026-10-01', String(DAILY_CAP));
    const res = await handleGaugeRequest(post({ request: 'Dean River' }), deps);

    expect(res.status).toBe(429);
    expect(notify).not.toHaveBeenCalled();
  });

  it('fails closed when the counter store is down — no uncounted email', async () => {
    const broken: KvLike = {
      get: async () => {
        throw new Error('kv down');
      },
      put: async () => {},
    };
    const { deps, notify } = makeDeps({ kv: broken });
    const res = await handleGaugeRequest(post({ request: 'Dean River' }), deps);

    expect(res.status).toBe(503);
    expect(notify).not.toHaveBeenCalled();
  });

  it('tells the visitor to retry when the email itself fails', async () => {
    const { deps } = makeDeps({
      notify: async () => {
        throw new Error('send failed');
      },
    });
    const res = await handleGaugeRequest(post({ request: 'Dean River' }), deps);

    expect(res.status).toBe(502);
    expect((await read(res)).ok).toBe(false);
  });
});
