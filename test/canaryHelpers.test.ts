import { describe, expect, it, vi } from 'vitest';
import {
  cacheInboundToken,
  canarySubjectMarker,
  isCanaryMessage,
  LAST_TOKEN_KEY,
} from '../src/canaryHelpers.js';

function kv() {
  const store: Record<string, string> = {};
  return {
    store,
    get: vi.fn(async (k: string) => store[k] ?? null),
    put: vi.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
  };
}

describe('cacheInboundToken', () => {
  it('stores {token, receivedAt} JSON under the shared status key', async () => {
    const store = kv();
    await cacheInboundToken(store, 'abc-123', new Date('2026-07-02T10:00:00Z'));
    expect(JSON.parse(store.store[LAST_TOKEN_KEY]!)).toEqual({
      token: 'abc-123',
      receivedAt: '2026-07-02T10:00:00.000Z',
    });
  });

  it('does nothing without a token (plain email, no inreachlink)', async () => {
    const store = kv();
    await cacheInboundToken(store, null);
    expect(store.put).not.toHaveBeenCalled();
  });

  it('swallows KV failures — the reply path must never notice', async () => {
    const broken = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {
        throw new Error('kv down');
      }),
    };
    await expect(cacheInboundToken(broken, 'abc')).resolves.toBeUndefined();
  });
});

describe('isCanaryMessage', () => {
  const FROM = 'canary@example.com';
  const SECRET = 's3cr3t';
  const subject = `flow canary 42 ${canarySubjectMarker(SECRET)}`;

  it('matches address + secret marker', () => {
    expect(isCanaryMessage(FROM, subject, FROM, SECRET)).toBe(true);
  });

  it('address alone is NOT enough (From is spoofable, address is public)', () => {
    expect(isCanaryMessage(FROM, 'flow canary 42', FROM, SECRET)).toBe(false);
  });

  it('secret alone is not enough either', () => {
    expect(isCanaryMessage('stranger@evil.com', subject, FROM, SECRET)).toBe(false);
  });

  it('address comparison is case- and whitespace-insensitive', () => {
    expect(isCanaryMessage(' Canary@Example.COM ', subject, FROM, SECRET)).toBe(true);
  });

  it('dormant (treats everything as real traffic) when unconfigured', () => {
    expect(isCanaryMessage(FROM, subject, undefined, SECRET)).toBe(false);
    expect(isCanaryMessage(FROM, subject, FROM, undefined)).toBe(false);
    expect(isCanaryMessage(FROM, subject, '', '')).toBe(false);
  });

  it('wrong secret in the marker does not match', () => {
    expect(isCanaryMessage(FROM, `x ${canarySubjectMarker('other')}`, FROM, SECRET)).toBe(false);
  });
});
