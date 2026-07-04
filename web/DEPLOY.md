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
`wrangler pages deploy web --project-name=flow` on every push to `main` that
touches `web/**`.

One-time setup — the workflow needs a Cloudflare API token in GitHub secrets:

1. Go to [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token**
2. Use the **Edit Cloudflare Workers** template, or a custom token with
   **Account → Cloudflare Pages → Edit** permission
3. Add it to the repo: `gh secret set CLOUDFLARE_API_TOKEN -R owenriverk/flow`

Manual deploys still work anytime: `npx wrangler pages deploy web --project-name=flow`.

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
