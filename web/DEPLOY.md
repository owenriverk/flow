# Deployment Guide: lateboof.com

This document outlines the steps to deploy the lateboof landing page to Cloudflare Pages with a custom domain.

## Prerequisites

- Repository pushed to GitHub
- Cloudflare account with domain management access
- Supabase project URL and anon key (from Task 6)

## Deployment Steps

### Step 1: Push Repository to GitHub

```bash
git remote add origin https://github.com/YOUR_USERNAME/flow.git
git push -u origin main
```

### Step 2: Connect to Cloudflare Pages

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Navigate to **Workers & Pages → Create application → Pages → Connect to Git**
3. Select the `flow` repository
4. Configure the build settings:
   - **Framework preset:** None
   - **Build command:** (leave empty)
   - **Build output directory:** `web`
5. Click **Save and Deploy**

The first deployment takes approximately 1 minute. Cloudflare will assign a temporary `*.pages.dev` URL for testing.

### Step 3: Add Custom Domain

1. In Cloudflare Pages, select your `flow` project
2. Go to **Custom domains → Set up a custom domain**
3. Enter `lateboof.com` and follow the DNS instructions
4. Add a CNAME record in Cloudflare DNS pointing to your Pages deployment
5. (Optional) Add `www.lateboof.com` and configure a redirect to `lateboof.com` via a Page Rule or Redirect Rule

## Configuration: Add Supabase Credentials

The app requires Supabase credentials to fetch live river flow data.

1. Open `web/gauges.js`
2. Replace the placeholder values with your actual credentials:
   - `YOUR_PROJECT_ID` → Your Supabase project ID (from Supabase dashboard)
   - `YOUR_ANON_KEY` → Your Supabase anon key (from Supabase dashboard → Settings → API)

Example:
```javascript
const SUPABASE_URL = 'https://your-project-id.supabase.co';
const SUPABASE_KEY = 'your-anon-key-here';
```

## Verification

Once deployed, verify both pages are live:

1. **Index page:** Open [https://lateboof.com](https://lateboof.com)
   - Should display the landing page with river overview
2. **Gauge directory:** Open [https://lateboof.com/gauges.html](https://lateboof.com/gauges.html)
   - Should display a table of rivers with live flow data
   - Rivers with configured `low`/`high` thresholds will show color-coded values (red/green/blue)

## Live Data Refresh

The gauges page automatically refreshes live data every 10 minutes. No manual intervention required.

## Troubleshooting

- **Blank page or no data:** Verify Supabase credentials in `web/gauges.js` are correct
- **Build failed:** Ensure the `web` directory is the build output (contains `index.html` and `gauges.html`)
- **Domain not resolving:** Check that the CNAME record is properly configured in Cloudflare DNS
