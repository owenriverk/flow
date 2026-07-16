import { describe, expect, test } from 'vitest';
import {
  validateTwilioSignature,
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

describe('parseSmsWebhook', () => {
  test('extracts From and Body, trimming the query', () => {
    const r = parseSmsWebhook({ From: '+15555550123', Body: '  gauley summersville  ' });
    expect(r).toEqual({
      from: '+15555550123',
      body: '  gauley summersville  ',
      query: 'gauley summersville',
    });
  });

  test('defaults missing fields to empty strings', () => {
    expect(parseSmsWebhook({})).toEqual({ from: '', body: '', query: '' });
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
