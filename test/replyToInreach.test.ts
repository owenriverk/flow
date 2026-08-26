import { describe, expect, test, vi } from 'vitest';
import {
  replyToInreach,
  locateReplyAction,
  scrapeActionId,
  scrapeScriptUrls,
  rscError,
  InreachReplyError,
} from '../src/replyToInreach.js';

// Mirrors the real messenger.garmin.com reply page (2026-08-26): a Next.js app
// whose scripts live under an asset prefix, one of them the route chunk.
const PAGE_URL = 'https://messenger.garmin.com/r?extId=tok';
const PAGE = `
<!DOCTYPE html><html><head>
<script src="/web/_next/static/chunks/webpack-a77fffdd79235d56.js" async=""></script>
<script src="/web/_next/static/chunks/main-app-7a8446b6733de863.js" async=""></script>
<script async="" src="/web/_next/static/chunks/app/(public)/reply/%5BtinyUrlId%5D/page-bd52b15b7da15760.js"></script>
</head><body><title>Garmin Messenger</title></body></html>`;
const ACTION_ID = '60e0518dd113775ab471a769fddd3860d84bad10e6';
// The compiled registration, verbatim shape from the live bundle.
const ROUTE_CHUNK = `var m=r(70468);let g=(0,m.createServerReference)("${ACTION_ID}",m.callServer,void 0,m.findSourceMapURL,"sendReplyAction");function y({message:e}){}`;
const OTHER_CHUNK = 'self.__next_f=self.__next_f||[];(function(){"use strict"})();';
// Verbatim success response from a live send (2026-08-26, landed on a real device):
// the action returns void, which RSC encodes as "$undefined".
const RSC_OK = '0:{"a":"$@1","f":"","q":"","i":false,"b":"2G0v-fhwaWv_MfECOXpLQ"}\n1:"$undefined"\n';
const RSC_THROWN = '0:{"a":"$@1","f":"","q":"","i":false,"b":"2G0v-fhwaWv_MfECOXpLQ"}\n1:E{"digest":"3346471139"}\n';

type Route = { ok?: boolean; status?: number; url?: string; body?: string };

/** fetch mock keyed by URL substring; page GET, chunk GETs and the action POST. */
function mock(routes: { page?: Route; route?: Route; other?: Route; post?: Route } = {}) {
  const build = (r: Route, fallbackUrl: string, fallbackBody: string) =>
    ({
      ok: r.ok ?? true,
      status: r.status ?? 200,
      url: r.url ?? fallbackUrl,
      text: async () => r.body ?? fallbackBody,
    }) as unknown as Response;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') return build(routes.post ?? {}, url, RSC_OK);
    if (url.includes('inreachlink.com')) return build(routes.page ?? {}, PAGE_URL, PAGE);
    if (url.includes('/page-')) return build(routes.route ?? {}, url, ROUTE_CHUNK);
    return build(routes.other ?? {}, url, OTHER_CHUNK);
  });
}

describe('scrapeScriptUrls', () => {
  test('resolves every <script src> against the page URL, any attribute order', () => {
    const urls = scrapeScriptUrls(PAGE, PAGE_URL);
    expect(urls).toEqual([
      'https://messenger.garmin.com/web/_next/static/chunks/webpack-a77fffdd79235d56.js',
      'https://messenger.garmin.com/web/_next/static/chunks/main-app-7a8446b6733de863.js',
      'https://messenger.garmin.com/web/_next/static/chunks/app/(public)/reply/%5BtinyUrlId%5D/page-bd52b15b7da15760.js',
    ]);
  });

  test('ignores inline scripts', () => {
    expect(scrapeScriptUrls('<script>self.__next_f=[]</script>', PAGE_URL)).toEqual([]);
  });
});

describe('scrapeActionId', () => {
  test('reads the id registered under sendReplyAction', () => {
    expect(scrapeActionId(ROUTE_CHUNK)).toBe(ACTION_ID);
  });

  test('tolerates a direct (non-minified) call and single quotes', () => {
    expect(scrapeActionId(`createServerReference('abcdef0123456789abcdef01', cs, undefined, fs, 'sendReplyAction')`)).toBe(
      'abcdef0123456789abcdef01',
    );
  });

  test('does not borrow the id of a different action', () => {
    const js = `createServerReference)("1111111111111111111111111111111111111111",m.callServer,void 0,m.findSourceMapURL,"deleteMessageAction")`;
    expect(scrapeActionId(js)).toBeNull();
  });
});

describe('rscError', () => {
  test('null on a clean stream (the live success body)', () => {
    expect(rscError(RSC_OK)).toBeNull();
  });
  test('a multi-line reply survives JSON encoding', async () => {
    const fetchFn = mock();
    await replyToInreach('tok', 'Main Salmon, At White Bird, ID\nUSGS 13317000\n3,410 cfs / 12.15 ft', { fetchFn });
    const body = fetchFn.mock.calls[2]![1]!.body as string;
    expect(JSON.parse(body)[1]).toBe('Main Salmon, At White Bird, ID\nUSGS 13317000\n3,410 cfs / 12.15 ft');
  });
  test('describes a thrown action by digest', () => {
    expect(rscError(RSC_THROWN)).toBe('digest 3346471139');
  });
  test('prefers a message when the chunk carries one', () => {
    expect(rscError('1:E{"message":"Message expired","digest":"1"}')).toBe('Message expired');
  });
});

describe('locateReplyAction', () => {
  test('tries the route chunk first and stops there', async () => {
    const fetchFn = mock();
    await expect(locateReplyAction(PAGE, PAGE_URL, { fetchFn })).resolves.toBe(ACTION_ID);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0]![0])).toContain('/page-');
  });

  test('falls back to the other chunks when the route chunk moved', async () => {
    const fetchFn = mock({ route: { body: OTHER_CHUNK }, other: { body: ROUTE_CHUNK } });
    await expect(locateReplyAction(PAGE, PAGE_URL, { fetchFn })).resolves.toBe(ACTION_ID);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test("'format' when no chunk registers the action", async () => {
    const fetchFn = mock({ route: { body: OTHER_CHUNK } });
    const err = await locateReplyAction(PAGE, PAGE_URL, { fetchFn }).catch((e) => e);
    expect(err).toBeInstanceOf(InreachReplyError);
    expect(err.kind).toBe('format');
    expect(err.message).toContain('sendReplyAction');
  });

  test("'format' when the page has no script chunks at all", async () => {
    const err = await locateReplyAction('<html>challenge</html>', PAGE_URL, { fetchFn: mock() }).catch((e) => e);
    expect(err.kind).toBe('format');
  });

  test("'transport' when a chunk cannot be loaded", async () => {
    const fetchFn = mock({ route: { ok: false, status: 503 } });
    const err = await locateReplyAction(PAGE, PAGE_URL, { fetchFn }).catch((e) => e);
    expect(err).toBeInstanceOf(InreachReplyError);
    expect(err.kind).toBe('transport');
    expect(err.message).toContain('503');
  });
});

describe('replyToInreach', () => {
  test('resolves the page, finds the action, and invokes it the way the Send button does', async () => {
    const fetchFn = mock();
    await replyToInreach('tok', 'GAULEY 2800 cfs', { fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(String(fetchFn.mock.calls[0]![0])).toBe('https://inreachlink.com/tok');
    const [postUrl, postInit] = fetchFn.mock.calls[2]!;
    expect(postUrl).toBe(PAGE_URL);
    expect(postInit!.method).toBe('POST');
    const headers = postInit!.headers as Record<string, string>;
    expect(headers['next-action']).toBe(ACTION_ID);
    expect(headers['accept']).toBe('text/x-component');
    expect(headers['content-type']).toBe('text/plain;charset=UTF-8');
    expect(headers['origin']).toBe('https://messenger.garmin.com');
    expect(JSON.parse(postInit!.body as string)).toEqual(['tok', 'GAULEY 2800 cfs']);
  });

  test('posts wherever the redirect landed, never a hardcoded host', async () => {
    const fetchFn = mock({ page: { url: 'https://eu.messenger.garmin.com/r?extId=tok' } });
    await replyToInreach('tok', 'hi', { fetchFn });
    const [postUrl, postInit] = fetchFn.mock.calls[2]!;
    expect(postUrl).toBe('https://eu.messenger.garmin.com/r?extId=tok');
    expect((postInit!.headers as Record<string, string>)['origin']).toBe('https://eu.messenger.garmin.com');
    expect(String(fetchFn.mock.calls[1]![0])).toMatch(/^https:\/\/eu\.messenger\.garmin\.com\//);
  });

  test('url-encodes the token in the inreachlink URL', async () => {
    const fetchFn = mock();
    await replyToInreach('a b/c', 'hi', { fetchFn });
    expect(String(fetchFn.mock.calls[0]![0])).toBe('https://inreachlink.com/a%20b%2Fc');
  });

  test("'transport' when the reply page itself is not 200", async () => {
    const fetchFn = mock({ page: { ok: false, status: 403, body: 'challenge' } });
    const err = await replyToInreach('tok', 'hi', { fetchFn }).catch((e) => e);
    expect(err).toBeInstanceOf(InreachReplyError);
    expect(err.kind).toBe('transport');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("'format' when the action is missing — and nothing is posted", async () => {
    const fetchFn = mock({ route: { body: OTHER_CHUNK } });
    const err = await replyToInreach('tok', 'hi', { fetchFn }).catch((e) => e);
    expect(err.kind).toBe('format');
    expect(fetchFn.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  test("'rejected' on HTTP 500 + RSC error chunk (what a thrown action looks like live)", async () => {
    const fetchFn = mock({ post: { ok: false, status: 500, body: RSC_THROWN } });
    const err = await replyToInreach('tok', 'hi', { fetchFn }).catch((e) => e);
    expect(err).toBeInstanceOf(InreachReplyError);
    expect(err.kind).toBe('rejected');
    expect(err.message).toContain('HTTP 500');
    expect(err.message).toContain('digest 3346471139');
  });

  test("'rejected' on a 200 whose stream still carries an error chunk", async () => {
    const fetchFn = mock({ post: { status: 200, body: RSC_THROWN } });
    const err = await replyToInreach('tok', 'hi', { fetchFn }).catch((e) => e);
    expect(err.kind).toBe('rejected');
  });

  test("'transport' when a request throws (timeout / network)", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    const err = await replyToInreach('tok', 'hi', { fetchFn: fetchFn as unknown as typeof fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(InreachReplyError);
    expect(err.kind).toBe('transport');
    expect(err.message).toContain('socket hang up');
  });
});
