import { describe, expect, test, vi } from 'vitest';
import {
  senderKey,
  checkSmsThrottle,
  claimOwnerAlert,
  HOURLY_CAP,
  MONTHLY_CAP,
  INREACH_GATEWAY_CAPS,
} from '../src/smsThrottle.js';

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

const now = new Date('2026-08-05T14:30:00Z');
const SALT = 'test_auth_token_abc123';
const SENDER = 'a1b2c3d4e5f60718';
const hourKey = `sms:hr:${SENDER}:2026-08-05T14`;
const monthKey = `sms:mo:${SENDER}:2026-08`;

describe('senderKey', () => {
  test('is stable for the same number and salt', async () => {
    const a = await senderKey('+15555550123', SALT);
    const b = await senderKey('+15555550123', SALT);
    expect(a).toBe(b);
  });

  test('differs between numbers', async () => {
    const a = await senderKey('+15555550123', SALT);
    const b = await senderKey('+15555550124', SALT);
    expect(a).not.toBe(b);
  });

  // The salt is what makes the stored id opaque: US phone numbers are a small
  // enough space that an unsalted digest is brute-forceable in seconds.
  test('differs under a different salt, so the token genuinely keys it', async () => {
    const a = await senderKey('+15555550123', SALT);
    const b = await senderKey('+15555550123', 'a_rotated_token');
    expect(a).not.toBe(b);
  });

  test('never contains the number it came from', async () => {
    const id = await senderKey('+15555550123', SALT);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(id).not.toContain('5555550123');
  });
});

describe('checkSmsThrottle', () => {
  test('allows a first message and starts both counters', async () => {
    const store = kv();
    expect(await checkSmsThrottle(store, SENDER, now)).toEqual({ allow: true });
    expect(store.store[hourKey]).toBe('1');
    expect(store.store[monthKey]).toBe('1');
  });

  test('allows right up to the hourly cap', async () => {
    const store = kv({ [hourKey]: String(HOURLY_CAP - 1), [monthKey]: '20' });
    expect(await checkSmsThrottle(store, SENDER, now)).toEqual({ allow: true });
    expect(store.store[hourKey]).toBe(String(HOURLY_CAP));
  });

  test('the message that crosses the hourly cap gets one notice + an owner alert', async () => {
    const store = kv({ [hourKey]: String(HOURLY_CAP), [monthKey]: '20' });
    const d = await checkSmsThrottle(store, SENDER, now);
    expect(d.allow).toBe(false);
    expect(d.notice).toContain('too many texts this hour');
    expect(d.alert).toContain('hourly cap');
  });

  test('further messages in the same hour are silent — the notice is not repeated', async () => {
    const store = kv({ [hourKey]: String(HOURLY_CAP + 1), [monthKey]: '20' });
    const d = await checkSmsThrottle(store, SENDER, now);
    expect(d).toEqual({ allow: false });
    expect(d.notice).toBeUndefined();
    expect(d.alert).toBeUndefined();
  });

  test('a new hour clears the burst limit', async () => {
    const store = kv({ [hourKey]: String(HOURLY_CAP + 5), [monthKey]: '20' });
    const later = new Date('2026-08-05T15:00:00Z');
    expect(await checkSmsThrottle(store, SENDER, later)).toEqual({ allow: true });
  });

  test('the monthly cap stops a sender who stayed under the hourly one', async () => {
    const store = kv({ [monthKey]: String(MONTHLY_CAP) });
    const d = await checkSmsThrottle(store, SENDER, now);
    expect(d.allow).toBe(false);
    expect(d.notice).toContain('monthly limit reached');
    expect(d.alert).toContain('monthly cap');
  });

  // "Resets on the 1st" is the more actionable thing to hear when both are blown.
  test('the monthly notice wins when both caps are exceeded', async () => {
    const store = kv({ [hourKey]: String(HOURLY_CAP), [monthKey]: String(MONTHLY_CAP) });
    const d = await checkSmsThrottle(store, SENDER, now);
    expect(d.notice).toContain('monthly');
  });

  test('a new month clears the sustained limit', async () => {
    const store = kv({ [monthKey]: String(MONTHLY_CAP + 50) });
    const nextMonth = new Date('2026-09-01T00:05:00Z');
    expect(await checkSmsThrottle(store, SENDER, nextMonth)).toEqual({ allow: true });
  });

  test('throttled messages still count, so a flood cannot recover by continuing', async () => {
    const store = kv({ [hourKey]: String(HOURLY_CAP + 3), [monthKey]: '30' });
    await checkSmsThrottle(store, SENDER, now);
    expect(store.store[hourKey]).toBe(String(HOURLY_CAP + 4));
    expect(store.store[monthKey]).toBe('31');
  });

  test('senders are counted independently', async () => {
    const other = 'ffffffffffffffff';
    const store = kv({ [hourKey]: String(HOURLY_CAP + 1) });
    expect((await checkSmsThrottle(store, other, now)).allow).toBe(true);
  });

  // KV is schemaless. A garbage value must read as 0, not NaN — every comparison
  // against NaN is false, so a corrupt counter would silently disable the throttle.
  test('treats a corrupt counter value as zero rather than NaN', async () => {
    const store = kv({ [hourKey]: 'garbage', [monthKey]: 'garbage' });
    expect(await checkSmsThrottle(store, SENDER, now)).toEqual({ allow: true });
    expect(store.store[hourKey]).toBe('1');
    expect(store.store[monthKey]).toBe('1');
  });

  // Opposite posture to claimAiCall, same as claimMessageSid: the cost of a wrong
  // guess here is a few cents, the cost of silence is a paddler's only message.
  test('fails OPEN if the counters are unreadable', async () => {
    const broken = {
      get: vi.fn(async () => { throw new Error('kv down'); }),
      put: vi.fn(async () => {}),
    };
    expect(await checkSmsThrottle(broken, SENDER, now)).toEqual({ allow: true });
  });

  test('a write failure does not block the message', async () => {
    const halfBroken = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => { throw new Error('write failed'); }),
    };
    expect(await checkSmsThrottle(halfBroken, SENDER, now)).toEqual({ allow: true });
  });

  test('the notices fit one SMS segment', async () => {
    const hourly = kv({ [hourKey]: String(HOURLY_CAP) });
    const monthly = kv({ [monthKey]: String(MONTHLY_CAP) });
    const a = await checkSmsThrottle(hourly, SENDER, now);
    const b = await checkSmsThrottle(monthly, SENDER, now);
    expect(a.notice!.length).toBeLessThanOrEqual(160);
    expect(b.notice!.length).toBeLessThanOrEqual(160);
  });
});

// Without this the feature is an amplifier: a flood at the toll-free number would
// become a flood at the owner's inbox, sent by us.
describe('claimOwnerAlert', () => {
  test('allows the first alert for a sender', async () => {
    const store = kv();
    expect(await claimOwnerAlert(store, SENDER)).toBe(true);
    expect(store.store[`sms:alerted:${SENDER}`]).toBe('1');
  });

  test('suppresses a second alert for the same sender', async () => {
    const store = kv({ [`sms:alerted:${SENDER}`]: '1' });
    expect(await claimOwnerAlert(store, SENDER)).toBe(false);
  });

  test('a different sender still alerts', async () => {
    const store = kv({ [`sms:alerted:${SENDER}`]: '1' });
    expect(await claimOwnerAlert(store, 'ffffffffffffffff')).toBe(true);
  });

  // Fails CLOSED, unlike the throttle itself: a missed notification is
  // recoverable, a mail flood during an incident is not.
  test('fails CLOSED (sends nothing) if KV is broken', async () => {
    const broken = {
      get: vi.fn(async () => { throw new Error('kv down'); }),
      put: vi.fn(async () => {}),
    };
    expect(await claimOwnerAlert(broken, SENDER)).toBe(false);
  });
});

describe('checkSmsThrottle with inReach gateway caps', () => {
  // Garmin relays inReach texts from pooled gateway numbers, so one `From` can be
  // many paddlers; the larger bucket must kick in only when the caller asks for it.
  const sender = 'gateway-hash';
  const now = new Date('2026-08-05T14:30:00Z');
  const hourKey = `sms:hr:${sender}:2026-08-05T14`;
  const monthKey = `sms:mo:${sender}:2026-08`;

  test('the phone-sized hourly cap does not apply to a gateway sender', async () => {
    const store = kv({ [hourKey]: String(HOURLY_CAP), [monthKey]: '20' });
    expect(await checkSmsThrottle(store, sender, now, INREACH_GATEWAY_CAPS)).toEqual({ allow: true });
  });

  test('the gateway bucket still has a ceiling, with the cap in the notice', async () => {
    const store = kv({ [hourKey]: String(INREACH_GATEWAY_CAPS.hourly), [monthKey]: '20' });
    const d = await checkSmsThrottle(store, sender, now, INREACH_GATEWAY_CAPS);
    expect(d.allow).toBe(false);
    expect(d.notice).toContain(`limit ${INREACH_GATEWAY_CAPS.hourly}`);
    expect(d.alert).toContain(`${INREACH_GATEWAY_CAPS.hourly}/hr`);
  });

  test('gateway caps are larger than phone caps in both windows', () => {
    expect(INREACH_GATEWAY_CAPS.hourly).toBeGreaterThan(HOURLY_CAP);
    expect(INREACH_GATEWAY_CAPS.monthly).toBeGreaterThan(MONTHLY_CAP);
  });
});
