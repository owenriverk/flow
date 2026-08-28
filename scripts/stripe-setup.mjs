#!/usr/bin/env node
/**
 * One-shot Stripe setup for lateboof.com/support — creates the product, the
 * choose-your-own-amount price, the Payment Link (with the optional "name for
 * the supporters list" field), and the webhook endpoint that feeds
 * web/functions/api/stripe-webhook.ts. Prints the two values you have to
 * place by hand: the Payment Link URL (into web/support.html) and the webhook
 * signing secret (into a Pages secret).
 *
 *   STRIPE_SECRET_KEY=sk_live_… node scripts/stripe-setup.mjs
 *
 * Safe to re-run: every create uses a fixed Idempotency-Key, so Stripe returns
 * the original objects instead of making duplicates. The webhook secret is only
 * revealed on first creation — re-runs print the endpoint id and tell you where
 * to find the secret in the dashboard.
 */

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY || !/^sk_(live|test)_/.test(KEY)) {
  console.error('set STRIPE_SECRET_KEY to a Stripe secret key (sk_live_… or sk_test_…)');
  process.exit(2);
}

const SITE = process.env.SITE_URL ?? 'https://lateboof.com';
const MODE = KEY.startsWith('sk_test_') ? 'test' : 'live';
const IDEM = `lateboof-support-v1-${MODE}`;

/** Flatten {a:{b:1}, c:[x]} into Stripe's form encoding: a[b]=1, c[0]=x. */
function encode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' ? encode(item, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))));
    else if (typeof v === 'object') encode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe(path, body, idem) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `${IDEM}-${idem}`,
    },
    body: encode(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${json.error?.message ?? res.status}`);
  return json;
}

const product = await stripe('products', {
  name: 'Keep the line open — LateBoof',
  description: 'Keeps the free river-flow text line running: the toll-free number, carrier fees, gauge feeds, and hosting.',
  url: `${SITE}/support`,
}, 'product');

// Any amount from $1. The 30¢ fixed fee makes tiny gifts expensive (a $1 gift
// nets 67¢), but a higher floor is friction for the donor, and the donor's
// convenience wins here by choice. $10 is only the prefilled suggestion.
const price = await stripe('prices', {
  product: product.id,
  currency: 'usd',
  custom_unit_amount: { enabled: true, preset: 1000, minimum: 100 },
}, 'price');

const link = await stripe('payment_links', {
  line_items: [{ price: price.id, quantity: 1 }],
  submit_type: 'donate',
  custom_fields: [{
    key: 'supporter_name',
    label: { type: 'custom', custom: 'Name for the supporters list (optional)' },
    type: 'text',
    optional: true,
  }],
  custom_text: {
    submit: { message: 'Every dollar goes toward keeping the line open. Leave the name blank to stay anonymous.' },
  },
  after_completion: { type: 'redirect', redirect: { url: `${SITE}/support?thanks=1` } },
  metadata: { site: 'lateboof.com', purpose: 'keep-the-line-open' },
}, 'payment-link');

const endpoint = await stripe('webhook_endpoints', {
  url: `${SITE}/api/stripe-webhook`,
  enabled_events: ['checkout.session.completed', 'checkout.session.async_payment_succeeded'],
  description: 'lateboof.com/support donations',
}, 'webhook');

console.log(`
Stripe (${MODE} mode) is set up.

1. Payment Link — paste into web/support.html as PAYMENT_LINK:
   ${link.url}

2. Webhook endpoint ${endpoint.id} → ${endpoint.url}
${endpoint.secret
  ? `   Signing secret (shown once — store it now):
   npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name=flow
   (paste: ${endpoint.secret})`
  : `   Secret not returned (endpoint already existed). Reveal it in the Stripe
   dashboard → Developers → Webhooks → ${endpoint.id}, then:
   npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name=flow`}

3. The webhook also needs the Supabase service-role key as a Pages secret:
   npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name=flow

4. One-tap payments (dashboard → Settings → Payment methods). The link uses
   whatever is enabled there, so this is where donor friction is decided:
   - Apple Pay, Google Pay, Link: on by default — confirm they show as enabled.
   - Cash App Pay: turn on (popular with the under-35 crowd, one tap).
   - Leave bank debits (ACH) off: micro-deposit verification is the opposite
     of convenient for a $10 gift.
   Stripe's own checkout domain handles Apple Pay verification; nothing to add
   to lateboof.com.

Then send yourself a $1 donation with a name and watch it appear on ${SITE}/support.
`);
