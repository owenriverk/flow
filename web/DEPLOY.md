# Deployment Guide: lateboof.com

This document outlines the steps to deploy the lateboof landing page to Cloudflare Pages with a custom domain.

**Scope:** this covers the static `web/` site only (landing page + live gauge
table, no build step). Flow has two other pieces that deploy separately and
aren't covered here:

- The email bot (Cloudflare Email Worker) — see the root [README.md](../README.md) "Deploy" section.
- The Supabase project behind the live gauge data — schema in `../supabase/migrations/`, refresh logic in `../supabase/functions/refresh-gauges/`.

Deploying `web/` does not deploy either of those; all three pieces must be live for the full system to work.

## Prerequisites

- Repository pushed to GitHub
- Cloudflare account with domain management access
- Supabase project URL and anon key — already committed in `web/gauges.js`; only needed again if rotating (see Configuration below)

## Deployment Steps

### Step 1: Push Repository to GitHub

```bash
git remote add origin https://github.com/YOUR_USERNAME/flow.git
git push -u origin main
```

### Step 2: Auto-deploy via GitHub Actions

The `flow` Pages project was created as a **direct upload** project (deploys
pushed with `wrangler pages deploy`), and Cloudflare does not allow converting
a direct-upload project to a git-connected one. Instead, auto-deploy is wired
up through GitHub Actions: `.github/workflows/deploy-pages.yml` runs
`wrangler pages deploy . --project-name=flow` from the `web/` directory on
every push to `main` that touches `web/**`. Running from `web/` matters:
Pages Functions live in `web/functions/` and wrangler only bundles a
`functions/` directory relative to its working directory.

One-time setup — the workflow needs a Cloudflare API token in GitHub secrets:

1. Go to [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token**
2. Use the **Edit Cloudflare Workers** template, or a custom token with
   **Account → Cloudflare Pages → Edit** permission
3. Add it to the repo: `gh secret set CLOUDFLARE_API_TOKEN -R owenriverk/flow`

Manual deploys still work anytime: `cd web && npx wrangler pages deploy . --project-name=flow`.

### Oracle signups (beehiiv)

`web/functions/api/subscribe.ts` proxies the Oracle signup forms to beehiiv so
the API key stays server-side. One-time setup:

```
cd web && npx wrangler pages secret put BEEHIIV_API_KEY --project-name=flow
```

(Or Pages project → Settings → Environment variables.) Without the key the
endpoint degrades to a friendly "email us and we'll add you by hand" message —
it never breaks the page. `BEEHIIV_PUBLICATION_ID` is baked in as a default
and only needs setting if the publication ever changes.

### Donations (Stripe → /support)

`web/support.html` shows a live goal bar and supporters list. The data path:
Stripe Payment Link → `POST /api/stripe-webhook` (`web/functions/api/stripe-webhook.ts`,
signature-verified, idempotent on the Checkout Session id) → `donations` table →
two anon-readable views (`donation_totals`, `supporters_public`) that expose only
names and the season total, never amounts or emails. The table has no anon policy
on purpose: a public insert key would let anyone put a name on the list for free.

One-time setup:

1. Apply `supabase/migrations/014_donations.sql` (SQL editor).
2. Create the Stripe objects — product, choose-your-amount price, Payment Link
   with the optional "name for the supporters list" field, and the webhook
   endpoint. Done 2026-08-27 on the Lateboof account (`acct_1U9GPFJGEtXhrzdO`)
   through the Stripe MCP: `prod_V9ZuljmpN2wYHt`, `price_1U9GlpJGEtXhrzdOWgRCL1jn`,
   `plink_1U9GmQJGEtXhrzdOPUMnwPBK`, webhook `we_1U9GlNJGEtXhrzdOC6wyMV7H`.
   For a fresh account, `STRIPE_SECRET_KEY=sk_live_… node scripts/stripe-setup.mjs`
   recreates the same set and prints the link URL and signing secret.
3. Paste the Payment Link URL into `web/support.html` as `PAYMENT_LINK` and as the
   Chip in button's `href` (the no-JS fallback).
4. Secrets on the Pages project (Production):
   ```
   npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name=flow
   npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name=flow
   ```
   Optional: `DONATION_SEASON` (defaults to `2027`; also set `data-season` on the
   goal box in `support.html` when it changes).
5. Send yourself a $1 donation with a name; it should appear on `/support` within
   a minute. Stripe retries any non-2xx, so a missing secret (503) or a Supabase
   hiccup (502) is recovered, not lost.

River and Title sponsors pay by invoice and are entered by hand (example insert
at the bottom of migration 014). Hide a name without deleting the record with
`update donations set approved = false where id = …`. Refunds are rare enough to
handle the same way: delete the row (or set `approved = false` and zero
`amount_cents`) after refunding in Stripe.

Testing the webhook the way Stripe recommends, against a local `wrangler pages dev`:

```
cd web && npx wrangler pages dev . --port 8790 \
  --binding STRIPE_WEBHOOK_SECRET=<secret printed by stripe listen> \
  --binding SUPABASE_SERVICE_ROLE_KEY=<key>
stripe listen --forward-to localhost:8790/api/stripe-webhook   # prints a whsec_ for this session
stripe trigger checkout.session.completed                       # a paid fixture → one row lands
```

Optional hardening Stripe suggests alongside signatures: a Cloudflare WAF custom
rule that blocks `POST /api/stripe-webhook` from any IP not on Stripe's published
webhook list (https://stripe.com/files/ips/ips_webhooks.txt). The signature check
already rejects forgeries; the rule only saves the Function from parsing junk.
Stripe announces list changes in advance, but a stale rule silently blocks real
deliveries, so only add it if you'll keep it current.

### Step 3: Add Custom Domain

1. In Cloudflare Pages, select your `flow` project
2. Go to **Custom domains → Set up a custom domain**
3. Enter `lateboof.com` and follow the DNS instructions
4. Add a CNAME record in Cloudflare DNS pointing to your Pages deployment
5. (Optional) Add `www.lateboof.com` and configure a redirect to `lateboof.com` via a Page Rule or Redirect Rule

## Configuration: Supabase Credentials

`web/gauges.js` already has live Supabase credentials committed at the top
(`SUPABASE_URL` and `ANON_KEY`) — there's nothing to fill in for a normal
deploy. The anon key is the public/read-only key; the `gauges` table has row
level security enabled with a public `select`-only policy, so it's safe to
ship client-side (see `../supabase/migrations/001_gauges.sql`).

### Rotating credentials (if ever needed)

1. Supabase dashboard → your project → **Settings → API**
2. Copy the **Project URL** and **anon/public key**
3. Update the `SUPABASE_URL` and `ANON_KEY` consts at the top of `web/gauges.js`
4. Commit and push — there's no build step, so the next deploy picks it up

## Verification

Once deployed, verify the site is live:

1. **Index page:** Open [https://lateboof.com](https://lateboof.com)
   - Should display the landing page with the live gauge table (river, location, flow, text-command, updated)
   - Rivers with configured `low`/`high` thresholds show color-coded rows (red/green/blue)
2. **Gauge directory redirect:** Open [https://lateboof.com/gauges.html](https://lateboof.com/gauges.html)
   - `gauges.html` is now just a meta-refresh stub (kept for old links/bookmarks) — it should bounce straight to `/`, not show its own table

## Live Data Refresh

The live gauge table on the index page automatically refreshes every 10 minutes (`REFRESH_MS` in `web/gauges.js`). No manual intervention required.

## Troubleshooting

- **Blank page or no data:** Verify the Supabase credentials in `web/gauges.js` are still valid (e.g. project wasn't recreated or the key wasn't rotated) — see "Rotating credentials" above
- **Build failed:** Ensure the `web` directory is the build output; it should contain `index.html`, `gauges.html`, `help.html`, `status.html`, `gauges.js`, and `style.css`
- **Domain not resolving:** Check that the CNAME record is properly configured in Cloudflare DNS
