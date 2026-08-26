/**
 * Send a reply to an InReach device via Garmin's web reply page.
 *
 * There is no email reply path — Garmin's address bounces ("Replies to this email
 * are not answered"). This reproduces what the reply page does when you press Send.
 *
 * HISTORY. Until 2026-08-23 the token redirected to <pod>.explore.garmin.com, a
 * classic HTML form (MessageId/Guid/ReplyAddress inputs, form-urlencoded POST to
 * /TextMessage/TxtMsg, {"Success":true}). Between 2026-08-23 and 2026-08-26 Garmin
 * moved it to messenger.garmin.com, a Next.js app whose Send button invokes a
 * Server Action. The request below was verified live on 2026-08-26: a bogus token
 * comes back HTTP 500 + an RSC error chunk (a thrown action), and a real token
 * comes back HTTP 200 + `1:"$undefined"` (the action returns void) with the text
 * landing on the device:
 *
 *   token (from the inbound email body)
 *     │ GET https://inreachlink.com/<token>
 *     ▼ (301 → https://messenger.garmin.com/r?extId=<token>)
 *   read the page's <script src> chunks; the one that registers
 *   createServerReference("<hex id>", …, "sendReplyAction") holds the action id
 *     │ POST <page url>      Next-Action: <id>    Accept: text/x-component
 *     ▼ body: JSON ["<token>", "<text>"]         (the action's two arguments)
 *   HTTP 200 + RSC stream with no `N:E{…}` error chunk → delivered
 *
 * Nothing is hardcoded but the action NAME: the host comes from the redirect
 * (never assume messenger.garmin.com stays put) and the action id from the page's
 * own scripts (it changes on every Garmin deploy).
 *
 * Caveat: unofficial endpoint. If Garmin changes the page again this throws with
 * kind 'format', the Worker logs it and emails the owner (src/worker.ts), and the
 * nightly check in src/canaryGarmin.ts — which runs EXACTLY the discovery below —
 * flags it the same night. SMS is the fallback channel.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

/** The Server Action the page's Send button calls. The only string we depend on. */
export const REPLY_ACTION_NAME = 'sendReplyAction';

/**
 *   transport — network/timeout/non-200 on our side of the fence (retryable)
 *   format    — the page loaded but the reply action is not where we look
 *               (Garmin changed the page, or served a stripped page)
 *   rejected  — the action ran and threw (bad/expired token, message refused)
 */
export type InreachReplyErrorKind = 'transport' | 'format' | 'rejected';

export class InreachReplyError extends Error {
  override name = 'InreachReplyError';
  constructor(
    message: string,
    readonly kind: InreachReplyErrorKind = 'transport',
  ) {
    super(message);
  }
}

export interface ReplyDeps {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

async function withTimeout(
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fn(ctrl.signal);
  } catch (e) {
    throw new InreachReplyError(`request failed: ${(e as Error).message}`, 'transport');
  } finally {
    clearTimeout(timer);
  }
}

/** Every <script src> on the page, resolved against the page URL (Next.js emits
 *  them as absolute paths under its asset prefix, e.g. /web/_next/static/...). */
export function scrapeScriptUrls(html: string, pageUrl: string): string[] {
  const urls: string[] = [];
  const re = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    try {
      urls.push(new URL(m[1]!, pageUrl).toString());
    } catch {
      // unparseable src — skip it
    }
  }
  return urls;
}

/** The action id a chunk registers under REPLY_ACTION_NAME, or null. Matches the
 *  compiled shape `(0,m.createServerReference)("<id>",m.callServer,void 0,
 *  m.findSourceMapURL,"sendReplyAction")`, tolerant of the minifier's spelling. */
export function scrapeActionId(js: string): string | null {
  const re = new RegExp(
    `createServerReference\\)?\\(\\s*["']([0-9a-f]{20,})["'][^)]{0,300}?["']${REPLY_ACTION_NAME}["']`,
    'i',
  );
  const m = js.match(re);
  return m ? m[1]! : null;
}

/** Route chunks (`…/page-<hash>.js`) carry the page's own code, so they are the
 *  likely home of the action; the framework/vendor chunks are the fallback. */
function orderCandidates(urls: string[]): string[] {
  const isRoute = (u: string) => /\/page-[^/]*\.js(\?|$)/.test(u);
  return [...urls.filter(isRoute), ...urls.filter((u) => !isRoute(u))];
}

/**
 * Find the reply Server Action id for a reply page that has already been fetched.
 * Exported for the nightly Garmin check (src/canaryGarmin.ts), which must run the
 * same discovery the reply path runs — the whole point is detecting when it breaks.
 * Throws InreachReplyError: 'format' when the page is there but the action is not,
 * 'transport' when a script could not be loaded (a monitor-side block is not proof).
 */
export async function locateReplyAction(
  html: string,
  pageUrl: string,
  deps: ReplyDeps = {},
): Promise<string> {
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const scripts = scrapeScriptUrls(html, pageUrl);
  if (scripts.length === 0) {
    throw new InreachReplyError('reply page has no script chunks (page format changed?)', 'format');
  }
  for (const url of orderCandidates(scripts)) {
    const res = await withTimeout(timeoutMs, (signal) => fetchFn(url, { signal }));
    if (!res.ok) {
      throw new InreachReplyError(`reply page script returned HTTP ${res.status}`, 'transport');
    }
    const id = scrapeActionId(await res.text());
    if (id) return id;
  }
  throw new InreachReplyError(
    `could not find ${REPLY_ACTION_NAME} in ${scripts.length} page script(s) (page format changed?)`,
    'format',
  );
}

/** The RSC error chunk (`N:E{"digest":"…"}`) a thrown Server Action produces, as a
 *  short description, or null when the stream carries no error. */
export function rscError(body: string): string | null {
  const m = body.match(/^\d+:E(\{.*\})\s*$/m);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]!) as { digest?: string; message?: string };
    return parsed.message ?? (parsed.digest ? `digest ${parsed.digest}` : 'error chunk');
  } catch {
    return 'error chunk';
  }
}

export async function replyToInreach(token: string, text: string, deps: ReplyDeps = {}): Promise<void> {
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // 1. Resolve the reply page (follows the redirect to wherever Garmin hosts it now).
  const page = await withTimeout(timeoutMs, (signal) =>
    fetchFn(`https://inreachlink.com/${encodeURIComponent(token)}`, { redirect: 'follow', signal }),
  );
  if (!page.ok) {
    throw new InreachReplyError(`reply page returned HTTP ${page.status}`, 'transport');
  }
  const pageUrl = page.url;
  const html = await page.text();

  // 2. Find the Server Action id in the page's own scripts.
  const actionId = await locateReplyAction(html, pageUrl, { fetchFn, timeoutMs });

  // 3. Invoke the action exactly as the page's Send button does: POST back to the
  //    page URL, Next-Action header, JSON array of the action's arguments.
  const res = await withTimeout(timeoutMs, (signal) =>
    fetchFn(pageUrl, {
      method: 'POST',
      headers: {
        accept: 'text/x-component',
        'content-type': 'text/plain;charset=UTF-8',
        'next-action': actionId,
        origin: new URL(pageUrl).origin,
      },
      body: JSON.stringify([token, text]),
      signal,
    }),
  );
  const body = await res.text();
  const error = rscError(body);
  if (!res.ok || error) {
    throw new InreachReplyError(
      `Garmin rejected the reply (HTTP ${res.status}${error ? `, ${error}` : ''})`,
      'rejected',
    );
  }
}
