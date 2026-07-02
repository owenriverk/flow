/**
 * Send a reply to an InReach device via Garmin's web reply form.
 *
 * There is no email reply path — Garmin's address bounces ("Replies to this email
 * are not answered"). This reproduces what the inreachlink.com web form does, the
 * exact request verified live (returned {"Success":true} and landed on the device):
 *
 *   token (from the inbound email body)
 *     │ GET https://inreachlink.com/<token>
 *     ▼ (302 → https://<pod>.explore.garmin.com/textmessage/txtmsg?extId=<token>)
 *   scrape MessageId, Guid, ReplyAddress from the page HTML
 *     │ POST <pod>/TextMessage/TxtMsg  (form-urlencoded)
 *     ▼
 *   {"Success":true} → delivered
 *
 * The pod (us0/eu0/…) is read from the redirect, never hardcoded — international
 * InReach users land on different pods.
 *
 * Caveat: unofficial endpoint. If Garmin changes the form, this throws and the
 * Worker logs it; SMS (v2) is the fallback channel.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

export class InreachReplyError extends Error {
  override name = 'InreachReplyError';
}

export interface ReplyDeps {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/** Pull an <input>'s value by id or name, tolerant of attribute order.
 *  Exported for the nightly Garmin form check (src/canaryGarmin.ts), which
 *  must parse the page with EXACTLY the logic the reply path uses — the whole
 *  point is detecting when this scrape would break. */
export function scrapeField(html: string, field: string): string | null {
  const tag = html.match(new RegExp(`<input\\b[^>]*\\b(?:id|name)=["']${field}["'][^>]*>`, 'i'));
  if (!tag) return null;
  const value = tag[0].match(/\bvalue=["']([^"']*)["']/i);
  return value ? value[1]! : null;
}

export async function replyToInreach(token: string, text: string, deps: ReplyDeps = {}): Promise<void> {
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const withTimeout = async (fn: (signal: AbortSignal) => Promise<Response>): Promise<Response> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fn(ctrl.signal);
    } catch (e) {
      throw new InreachReplyError(`request failed: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  };

  // 1. Resolve the reply page (follows the redirect to the geo pod).
  const page = await withTimeout((signal) =>
    fetchFn(`https://inreachlink.com/${encodeURIComponent(token)}`, { redirect: 'follow', signal }),
  );
  const podOrigin = new URL(page.url).origin;
  const html = await page.text();

  const messageId = scrapeField(html, 'MessageId');
  const guid = scrapeField(html, 'Guid');
  const replyAddress = scrapeField(html, 'ReplyAddress');
  if (!messageId || !guid || !replyAddress) {
    throw new InreachReplyError('could not read the reply form (page format changed?)');
  }

  // 2. POST the reply to the same pod.
  const body = new URLSearchParams({
    ReplyAddress: replyAddress,
    ReplyMessage: text,
    MessageId: messageId,
    Guid: guid,
  });
  const res = await withTimeout((signal) =>
    fetchFn(`${podOrigin}/TextMessage/TxtMsg`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: body.toString(),
      signal,
    }),
  );

  let json: { Success?: boolean };
  try {
    json = (await res.json()) as { Success?: boolean };
  } catch {
    throw new InreachReplyError(`reply POST returned non-JSON (status ${res.status})`);
  }
  if (json.Success !== true) {
    throw new InreachReplyError(`Garmin rejected the reply (status ${res.status})`);
  }
}
