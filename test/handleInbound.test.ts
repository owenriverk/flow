import { describe, expect, test, vi } from 'vitest';
import { handleInbound } from '../src/handleInbound.js';
import type { GaugeAlias } from '../src/lookupGauge.js';

const INREACH_BODY = `Middle Kings at Rodger's

View the location or send a reply to Owen Kurth:
https://inreachlink.com/gyWtLmrv-FK21I9GXuUZgFA

Do not reply directly to this message.`;

const aliases: Record<string, GaugeAlias> = {};
const handleQueryFn = async (q: string) => `REPLY: ${q}`;

describe('handleInbound', () => {
  test('InReach email (token present) → replies via the Garmin web form', async () => {
    const replyToInreach = vi.fn(async () => {});
    const replyByEmail = vi.fn(async () => {});
    await handleInbound(INREACH_BODY, { aliases, handleQueryFn, replyToInreach, replyByEmail });

    expect(replyToInreach).toHaveBeenCalledWith('gyWtLmrv-FK21I9GXuUZgFA', "REPLY: Middle Kings at Rodger's");
    expect(replyByEmail).not.toHaveBeenCalled();
  });

  test('normal email (no token) → replies by email to the sender', async () => {
    const replyToInreach = vi.fn(async () => {});
    const replyByEmail = vi.fn(async () => {});
    await handleInbound('main salmon', { aliases, handleQueryFn, replyToInreach, replyByEmail });

    expect(replyByEmail).toHaveBeenCalledWith('REPLY: main salmon');
    expect(replyToInreach).not.toHaveBeenCalled();
  });

  test('no token and no email-reply path → reports and sends nothing', async () => {
    const replyToInreach = vi.fn(async () => {});
    const onNoReplyPath = vi.fn();
    await handleInbound('stikine', { aliases, handleQueryFn, replyToInreach, onNoReplyPath });

    expect(onNoReplyPath).toHaveBeenCalledWith('stikine');
    expect(replyToInreach).not.toHaveBeenCalled();
  });

  test('onResolved fires with the query, reply, and channel before delivery', async () => {
    const onResolved = vi.fn();
    await handleInbound(INREACH_BODY, {
      aliases,
      handleQueryFn,
      replyToInreach: vi.fn(async () => {}),
      onResolved,
    });
    expect(onResolved).toHaveBeenCalledWith(
      "Middle Kings at Rodger's",
      "REPLY: Middle Kings at Rodger's",
      'inreach',
    );
  });

  test('onResolved reports channel "email" for a plain email reply', async () => {
    const onResolved = vi.fn();
    await handleInbound('main salmon', {
      aliases,
      handleQueryFn,
      replyByEmail: vi.fn(async () => {}),
      onResolved,
    });
    expect(onResolved).toHaveBeenCalledWith('main salmon', 'REPLY: main salmon', 'email');
  });

  test('onResolved reports channel "none" with no reply path available', async () => {
    const onResolved = vi.fn();
    await handleInbound('stikine', { aliases, handleQueryFn, onResolved });
    expect(onResolved).toHaveBeenCalledWith('stikine', 'REPLY: stikine', 'none');
  });
});
