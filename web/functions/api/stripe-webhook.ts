/**
 * Stripe → Supabase: records a paddler donation when a Checkout Session from the
 * /support Payment Link is paid, so the goal bar and the supporters list on
 * lateboof.com/support update themselves.
 *
 * POST /api/stripe-webhook — Stripe calls this; nothing on the site does.
 * Verification and mapping live in src/stripeWebhook.ts (unit-tested); this
 * file is the I/O shell, in the same shape as subscribe.ts.
 *
 * Idempotent: donations.stripe_session_id is unique and the insert asks
 * PostgREST to ignore duplicates, so Stripe's retries and the completed +
 * async_payment_succeeded pair for one session land exactly one row.
 *
 * Env (Pages project settings, Production):
 *   STRIPE_WEBHOOK_SECRET      required — the endpoint's signing secret (whsec_…)
 *   SUPABASE_SERVICE_ROLE_KEY  required — donations has no anon policy on purpose;
 *                              a public insert key would let anyone put a name on
 *                              the supporters list for free
 *   SUPABASE_URL               optional — defaults to the CFSbot project
 *   DONATION_SEASON            optional — which season new donations count toward
 */

import { donationFromEvent, verifyStripeSignature } from '../../../src/stripeWebhook.js';

interface Env {
  STRIPE_WEBHOOK_SECRET?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_URL?: string;
  DONATION_SEASON?: string;
}

const DEFAULT_SUPABASE_URL = 'https://vfkoegvzllxvshcnfbox.supabase.co';
const DEFAULT_SEASON = '2027';

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

export const onRequestGet = async (): Promise<Response> => text(405, 'POST only');

export const onRequestPost = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;
  if (!env.STRIPE_WEBHOOK_SECRET || !env.SUPABASE_SERVICE_ROLE_KEY) {
    // Stripe will retry a non-2xx, which is what we want until the secrets exist.
    return text(503, 'webhook not configured');
  }

  // The signature covers the raw bytes — parse only after verifying.
  const raw = await request.text();
  const ok = await verifyStripeSignature(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return text(400, 'invalid signature');

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return text(400, 'invalid json');
  }

  const row = donationFromEvent(event, env.DONATION_SEASON ?? DEFAULT_SEASON);
  if (!row) return text(200, 'ignored');

  const supabaseUrl = env.SUPABASE_URL ?? DEFAULT_SUPABASE_URL;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/donations?on_conflict=stripe_session_id`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error('donations insert failed', res.status, await res.text().catch(() => ''));
      return text(502, 'storage error'); // non-2xx → Stripe retries with backoff
    }
  } catch (e) {
    console.error('donations insert threw', e);
    return text(502, 'storage error');
  }
  return text(200, 'recorded');
};
