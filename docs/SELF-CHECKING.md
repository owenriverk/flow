# Self-checking (v1.5) — how it works and what you have to do once

The bot now watches itself. Design doc:
`~/.gstack/projects/owenriverk-flow/owen-main-design-20260701-142656.md`.
Steady-state owner load is near zero: alerts fire on state *transitions* only,
a digest arrives Sundays, and everything else is a status page you can ignore.

## The moving parts

```
Worker cron, nightly 14:00 UTC (wrangler.jsonc triggers)
  src/canaryRunner.ts   isolated checks, ≤1 email/night, state → KV → /api/status
    ├─ gauge sweep      src/canarySweep.ts   offline/stale/flatline vs Supabase gauges
    ├─ watchdog         (same file)          canary_last_seen() < 48h, else GitHub died
    └─ garmin form      src/canaryGarmin.ts  GET last real token's reply page, 3 fields

GitHub Action, nightly 10:00 UTC (.github/workflows/canary.yml)
    ├─ email canary     scripts/email-canary.mjs  real email in → reply out (IMAP-verified)
    └─ replay + digest  scripts/replay.ts         every past query re-resolved vs last night
```

The Worker watches the Action (watchdog) and the Action exercises the Worker
(email canary) — neither can die silently.

**Honest gap (accepted in review):** nothing automated exercises the actual
Garmin POST. That's what the seasonal ritual below is for.

## One-time setup (~45 min total)

1. **Migrations 008 + 009** — paste each into the Supabase SQL editor
   (`supabase/migrations/008_canary_channel.sql`, `009_replay_snapshot.sql`).
   008 must land BEFORE the first Action run, or canary rows are silently
   rejected by the channel CHECK.
2. **Canary mailbox** — a dedicated free mailbox (Gmail works: enable 2FA, make
   an app password; IMAP must be on). This account both sends the nightly query
   and receives the bot's reply.
3. **GitHub Actions secrets** (repo → Settings → Secrets → Actions):
   `CANARY_SMTP_HOST/PORT/USER/PASS`, `CANARY_IMAP_HOST/USER/PASS`,
   `CANARY_SECRET` (any long random string), `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` (Supabase dashboard → Settings → API — the
   service key, NOT the anon key; it must never be committed).
4. **Worker secrets** — `npx wrangler secret put CANARY_FROM` (the mailbox
   address) and `npx wrangler secret put CANARY_SECRET` (same string as the
   Actions secret). Until these exist, canary detection is dormant and the
   nightly email would count as real traffic.
5. **Deploy** — `npx wrangler deploy`, then trigger the workflow once by hand
   (Actions tab → canary → Run workflow) and verify:
   - a `channel='canary'` row exists in query_log (SQL editor)
   - the public email channel's `lastSuccessAt` on lateboof.com/status did NOT move
   - `select canary_last_seen();` returns the fresh timestamp
6. **THE ASSIGNMENT** (15 min, decides the garmin check's usefulness): open an
   inreachlink.com link from an InReach email older than 2 weeks. If the page
   still shows the reply form, tokens live long and the check works as built;
   if not, note the horizon and lower `maxTokenAgeHours` in
   `src/canaryGarmin.ts` — or accept it reads "unknown" most nights, which is
   by design and never alerts.

## Recurring (all optional-pace)

- **The 35-gauge audit** — for each `source:site` pair in `src/aliases.json`,
  confirm it's the gauge paddlers actually quote for that section, then add an
  entry to `src/provenance.json` and lower `MAX_UNAUDITED` in
  `test/provenance.test.ts`. `npx vitest run test/provenance.test.ts` prints
  the remaining list. Never blocks anything at any level of completion;
  finishing it (0) makes provenance a hard gate for future gauges.
- **Seasonal ritual (2x/year, pre-season + mid-season)** — text the bot from a
  real InReach, confirm the reply lands on the device, and record it under
  `rituals` in provenance.json (`{"date": "...", "device": "inreach mini 2",
  "result": "delivered"}`). The only true test of the Garmin POST; also
  refreshes the cached token so the nightly form check wakes up.
- **Sunday digest** — arrives by email; queries under "AI-carried" are the
  best alias candidates. Adding one is a data edit + the replay job's next run
  shows the diff as a one-time red receipt.

## Reading the signals

| Signal | Means | Do |
|---|---|---|
| "Nightly self-check: N item(s)" email | a state CHANGED (gauge died/recovered, canary stopped, form changed) | read the lines; standing state on lateboof.com/status |
| red `email-canary` Action run | reply pipe broke somewhere before the Garmin hop | check Worker logs (`npx wrangler tail`), Email Routing, mailbox |
| red `replay` Action run | a real paddler phrasing resolves differently than yesterday | intentional alias edit? then this red run is the receipt. Otherwise check recent commits to aliases.json / lookupGauge.ts |
| "garmin form: unknown" on status page | no fresh token to check — normal in the off-season | nothing; the ritual refreshes it |
| check shows `error` on status page | the monitor itself hit trouble (Supabase down etc.) | emailed once on transition; look only if it persists |
