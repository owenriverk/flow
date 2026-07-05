/**
 * Oracle signup → beehiiv, via a Pages Function so the API key stays server-side.
 * POST /api/subscribe with form-encoded or JSON { email }.
 *
 * Isolated from the bot Worker on purpose: this deploys with the static site
 * (wrangler pages deploy web), never touches the reply path.
 *
 * Env (Pages project settings):
 *   BEEHIIV_API_KEY        required — signups return 503 without it
 *   BEEHIIV_PUBLICATION_ID optional — defaults to the LateBoof Oracle publication
 */

interface Env {
  BEEHIIV_API_KEY?: string;
  BEEHIIV_PUBLICATION_ID?: string;
}

const DEFAULT_PUBLICATION = 'pub_286b5b89-e48e-4eab-998f-f1146c859639';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function reply(status: number, ok: boolean, message: string, wantsJson: boolean): Response {
  if (wantsJson) {
    return new Response(JSON.stringify({ ok, message }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }
  // No-JS fallback: a plain page in the site's voice with a way back.
  const body = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LateBoof — The Oracle</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/style.css"></head><body style="padding:2rem 1rem;font-family:inherit"><p style="font-weight:700">${message}</p><p><a href="/forecast.html">← Back to the Oracle</a></p></body></html>`;
  return new Response(body, { status, headers: { 'content-type': 'text/html' } });
}

export const onRequestPost = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');

  let email = '';
  try {
    const type = request.headers.get('content-type') ?? '';
    if (type.includes('application/json')) {
      email = String(((await request.json()) as { email?: string }).email ?? '');
    } else {
      email = String((await request.formData()).get('email') ?? '');
    }
  } catch {
    return reply(400, false, 'Could not read that — try again?', wantsJson);
  }

  email = email.trim();
  if (!EMAIL_RE.test(email)) {
    return reply(400, false, "That doesn't look like an email address — try again?", wantsJson);
  }

  if (!env.BEEHIIV_API_KEY) {
    return reply(503, false, 'Signups are almost live — email flow@lateboof.com and we will add you by hand.', wantsJson);
  }

  const publication = env.BEEHIIV_PUBLICATION_ID ?? DEFAULT_PUBLICATION;
  try {
    const res = await fetch(`https://api.beehiiv.com/v2/publications/${publication}/subscriptions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.BEEHIIV_API_KEY}`,
      },
      body: JSON.stringify({
        email,
        reactivate_existing: true, // resubscribing after unsubscribe is a choice, honor it
        utm_source: 'lateboof-oracle',
        referring_site: request.headers.get('referer') ?? 'https://lateboof.com',
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      // 400 duplicate reads as success to the subscriber — they're on the list either way.
      if (res.status === 400) {
        return reply(200, true, "You're in — first report lands with the April outlook.", wantsJson);
      }
      console.error('beehiiv error', res.status, await res.text().catch(() => ''));
      return reply(502, false, 'Signup hiccuped upstream — try again in a minute.', wantsJson);
    }
    return reply(200, true, "You're in — first report lands with the April outlook.", wantsJson);
  } catch (e) {
    console.error('beehiiv request failed', e);
    return reply(502, false, 'Signup hiccuped upstream — try again in a minute.', wantsJson);
  }
};
