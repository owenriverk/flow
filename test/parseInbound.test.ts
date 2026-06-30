import { describe, expect, test } from 'vitest';
import { parseInbound } from '../src/parseInbound.js';

// The real decoded body of an InReach email (captured 2026-06-28).
const REAL_BODY = `Middle Kings at Rodger's

View the location or send a reply to Owen Kurth:
https://inreachlink.com/gyWtLmrv-FK21I9GXuUZgFA



Do not reply directly to this message.

This message was sent to you using the inReach two-way satellite communicator with GPS. To learn more, visit http://explore.garmin.com/inreach.`;

describe('parseInbound', () => {
  test('extracts the query and the inreachlink reply token from a real InReach email', () => {
    expect(parseInbound(REAL_BODY)).toEqual({
      query: "Middle Kings at Rodger's",
      token: 'gyWtLmrv-FK21I9GXuUZgFA',
    });
  });

  test('strips the entire Garmin footer from the query', () => {
    const { query } = parseInbound(REAL_BODY);
    expect(query).not.toMatch(/View the location/i);
    expect(query).not.toMatch(/inreachlink/i);
    expect(query).not.toMatch(/Do not reply/i);
    expect(query).not.toMatch(/satellite communicator/i);
  });

  test('trims surrounding whitespace on the query', () => {
    expect(parseInbound('  gauley summersville  \n\nView the location or send a reply to X:\nhttps://inreachlink.com/abc123').query).toBe('gauley summersville');
  });

  test('returns null token when there is no reply link', () => {
    expect(parseInbound('main salmon\n\nView the location or send a reply to X:').token).toBeNull();
  });

  test('falls back to the whole trimmed body when no footer marker is present', () => {
    expect(parseInbound('  stikine  ')).toEqual({ query: 'stikine', token: null });
  });
});
