import { describe, expect, test, vi } from 'vitest';
import {
  validateTwilioSignature,
  claimMessageSid,
  parseSmsWebhook,
  isOptOutOrHelp,
  twimlMessage,
  twimlEmpty,
  xmlEscape,
} from '../src/sms.js';

// Known-answer signature fixtures, precomputed as HMAC-SHA1(base64) over Twilio's
// concatenation (URL + each POST param sorted by key, key immediately followed by
// value) — the reference the Worker's Web Crypto implementation must reproduce.
// `docSig` is Twilio's own published "Validating Signatures" example: an external
// anchor that pins the exact param-ordering convention, not just self-agreement.
describe('validateTwilioSignature', () => {
  const url = 'https://lateboof.com/api/sms';
  const params = {
    From: '+15555550123',
    To: '+18662845181',
    Body: 'gauley summersville',
    MessageSid: 'SM0123456789',
  };
  const token = 'test_auth_token_abc123';
  const validSig = 'BguFK3K5oLT9VuK920Mss2kyeug=';

  test('accepts a correctly signed request', async () => {
    expect(await validateTwilioSignature(url, params, token, validSig)).toBe(true);
  });

  test('rejects a tampered body (spoofed query)', async () => {
    const tampered = { ...params, Body: 'green narrows' };
    expect(await validateTwilioSignature(url, tampered, token, validSig)).toBe(false);
  });

  test('rejects a wrong auth token', async () => {
    expect(await validateTwilioSignature(url, params, 'wrong_token', validSig)).toBe(false);
  });

  test('fails closed on an empty token or missing signature', async () => {
    expect(await validateTwilioSignature(url, params, '', validSig)).toBe(false);
    expect(await validateTwilioSignature(url, params, token, '')).toBe(false);
  });

  test('rejects a non-empty but wrong-length signature', async () => {
    expect(await validateTwilioSignature(url, params, token, 'short')).toBe(false);
  });

  test("matches Twilio's documented reference vector", async () => {
    // The URL keeps its query string; only POST params are sorted and appended.
    const docUrl = 'https://mycompany.com/myapp.php?foo=1&bar=2';
    const docParams = {
      CallSid: 'CA1234567890ABCDE',
      Caller: '+14158675309',
      Digits: '1234',
      From: '+14158675309',
      To: '+18005551212',
    };
    const docSig = 'RSOYDt4T1cUTdK1PDd93/VVr8B8=';
    expect(await validateTwilioSignature(docUrl, docParams, '12345', docSig)).toBe(true);
  });
});

describe('claimMessageSid', () => {
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

  test('first delivery is claimed and remembered', async () => {
    const store = kv();
    expect(await claimMessageSid(store, 'SM0123456789')).toBe(true);
    expect(store.store['sms:sid:SM0123456789']).toBe('1');
  });

  test('a replay of the same sid is rejected', async () => {
    const store = kv({ 'sms:sid:SM0123456789': '1' });
    expect(await claimMessageSid(store, 'SM0123456789')).toBe(false);
  });

  test('a different sid is unaffected by a claimed one', async () => {
    const store = kv({ 'sms:sid:SM0123456789': '1' });
    expect(await claimMessageSid(store, 'SMdifferentsid')).toBe(true);
  });

  test('the remembered sid expires — the window IS the defense', async () => {
    const store = kv();
    await claimMessageSid(store, 'SM0123456789');
    expect(store.put).toHaveBeenCalledWith('sms:sid:SM0123456789', '1', {
      expirationTtl: 15 * 60,
    });
  });

  // Opposite posture to claimAiCall (test/budget.test.ts): that one fails closed
  // because the downside is money, this one fails open because the downside is a
  // paddler's single satellite message going unanswered.
  test('fails OPEN if the store is unreadable', async () => {
    const broken = {
      get: vi.fn(async () => { throw new Error('kv down'); }),
      put: vi.fn(async () => {}),
    };
    expect(await claimMessageSid(broken, 'SM0123456789')).toBe(true);
  });

  test('a write failure still lets the message through', async () => {
    const halfBroken = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => { throw new Error('write failed'); }),
    };
    expect(await claimMessageSid(halfBroken, 'SM0123456789')).toBe(true);
  });

  test('an absent sid is processed rather than dropped', async () => {
    const store = kv();
    expect(await claimMessageSid(store, '')).toBe(true);
    expect(store.get).not.toHaveBeenCalled();
  });
});

describe('parseSmsWebhook', () => {
  test('extracts From and Body, trimming the query', () => {
    const r = parseSmsWebhook({ From: '+15555550123', Body: '  gauley summersville  ' });
    expect(r).toEqual({
      from: '+15555550123',
      body: '  gauley summersville  ',
      query: 'gauley summersville',
      inreach: false,
    });
  });

  test('defaults missing fields to empty strings', () => {
    expect(parseSmsWebhook({})).toEqual({ from: '', body: '', query: '', inreach: false });
  });

  // Garmin's inReach→SMS relay appends a location/reply link, sometimes with a
  // line of boilerplate. None of it was typed by the paddler.
  test('strips the inReach relay footer and flags the text as inReach-relayed', () => {
    const r = parseSmsWebhook({
      From: '+15005550001',
      Body: 'mf salmon\n\nhttps://inreachlink.com/AbC12-xy\nDo not reply directly to this message.',
    });
    expect(r.query).toBe('mf salmon');
    expect(r.inreach).toBe(true);
  });

  test('strips a trailing link on the same line and collapses whitespace', () => {
    const r = parseSmsWebhook({ From: '+15005550001', Body: 'grand canyon   https://inreachlink.com/ZZZ' });
    expect(r.query).toBe('grand canyon');
    expect(r.inreach).toBe(true);
  });

  test('drops any other URL but does not flag it as inReach', () => {
    const r = parseSmsWebhook({ From: '+15555550123', Body: 'stikine https://example.com/x' });
    expect(r).toMatchObject({ query: 'stikine', inreach: false });
  });

  test('a body that is only a link becomes an empty query', () => {
    expect(parseSmsWebhook({ From: '+1', Body: 'https://inreachlink.com/only' }).query).toBe('');
  });
});

describe('isOptOutOrHelp', () => {
  // Pin every entry in RESERVED_KEYWORDS (plus case/whitespace variants) so
  // silently dropping one — which would let a compliance keyword be answered as a
  // gauge query — fails a test.
  test.each([
    'STOP', 'stop', ' Stop ', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT',
    'START', 'YES', 'UNSTOP', 'HELP', 'help', 'INFO',
  ])('%j is a reserved keyword the app must not treat as a gauge query', (kw) =>
    expect(isOptOutOrHelp(kw)).toBe(true),
  );

  test.each(['gauley', 'stop the river', 'help me find selway', ''])(
    '%j is a normal query',
    (q) => expect(isOptOutOrHelp(q)).toBe(false),
  );
});

describe('TwiML rendering', () => {
  test('twimlMessage wraps the reply', () => {
    expect(twimlMessage('2,800 cfs')).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>2,800 cfs</Message></Response>',
    );
  });

  test('escapes XML metacharacters so a name with & cannot break the document', () => {
    const xml = twimlMessage('Tom & Jerry <Creek> "x"');
    expect(xml).toContain('Tom &amp; Jerry &lt;Creek&gt; &quot;x&quot;');
    expect(xml).not.toContain('<Creek>');
  });

  test('xmlEscape covers all five metacharacters', () => {
    expect(xmlEscape(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;');
  });

  test('twimlEmpty replies with nothing (STOP/HELP handled by Twilio)', () => {
    expect(twimlEmpty()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });
});
