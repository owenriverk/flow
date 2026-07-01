import { describe, expect, test } from 'vitest';
import { buildReplyHeaders } from '../src/emailReply.js';

describe('buildReplyHeaders', () => {
  test('a first reply in a thread: References is just the parent (no ancestors to inherit)', () => {
    expect(buildReplyHeaders('<msg1@mail.gmail.com>', '')).toEqual({
      inReplyTo: '<msg1@mail.gmail.com>',
      references: '<msg1@mail.gmail.com>',
    });
  });

  // The real production incident (2026-06-30): the paddler replied to the bot's
  // reply, so the inbound message already carries a References chain of its own.
  // Dropping that chain and using only the immediate parent produced a References
  // header Gmail rejected outright: "provided References header is invalid".
  test('a later reply in a thread: References is the inbound chain plus the parent id', () => {
    const inboundReferences = '<original@mail.gmail.com> <bot-reply@lateboof.com>';
    expect(buildReplyHeaders('<followup@mail.gmail.com>', inboundReferences)).toEqual({
      inReplyTo: '<followup@mail.gmail.com>',
      references: '<original@mail.gmail.com> <bot-reply@lateboof.com> <followup@mail.gmail.com>',
    });
  });

  test('no Message-ID on the inbound message: no headers to set at all', () => {
    expect(buildReplyHeaders('', '')).toEqual({});
    expect(buildReplyHeaders('', '<some@chain.com>')).toEqual({});
  });
});
