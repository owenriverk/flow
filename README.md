# Flow

A satellite-text river-gauge bot for whitewater kayakers. Text a gauge name from a
Garmin InReach (no cell signal needed) and get the current flow back — free, no app.

See [DESIGN.md](./DESIGN.md) for the design and [RUNS.md](./RUNS.md) for the run roster.

## Status

**v1 built and tested end to end. Ready to deploy.** The full round trip is proven:
inbound email → parse → gauge lookup → reply delivered to the device (the reply path
was verified live against a real InReach — see DESIGN.md "How the email path works").

```
src/
  worker.ts          Cloudflare Email Worker entry — decodes MIME, calls handleInbound
  handleInbound.ts   glue: parseInbound -> handleQuery -> replyToInreach
  parseInbound.ts    InReach email body -> { query, reply token }
  replyToInreach.ts  reply via Garmin's web form (GET token page -> POST), verified live
  lookupGauge.ts     text -> { site, source, name?, location? } | null  (aliases + raw id)
  usgs.ts            USGS IV API (native cfs/ft), typed errors, 8s timeout
  wsc.ts             Water Survey of Canada (native cms/m), 8s timeout
  cdec.ts            California CDEC (native cfs/ft, per-station sensor/dur)
  errors.ts          shared GaugeError { kind: not_found | unavailable }
  time.ts            upstream timestamp -> { instant, utc offset }
  formatReply.ts     reading -> <=160 char reply, flow value never truncated
  handleQuery.ts     channel-agnostic core: text in, reply out, routes by source, never throws
  aliases.json       ~40 curated runs -> gauge (US/Canada/CA class V)
```

## Develop

```bash
npm install
npm test                 # vitest, 67 unit tests
npm run typecheck        # tsc --noEmit
LIVE=1 npm test -- test/live.test.ts   # hits real USGS/WSC/CDEC
```

## Deploy

```bash
npx wrangler login
npx wrangler deploy      # publishes the Worker
```

Then bind it: Cloudflare dashboard → `lateboof.com` → Email → Email Routing →
Routing rules → **Catch-all → action "Send to a Worker" → flow**. (Until then the
catch-all forwards to a personal inbox for testing.)

Live test: send a gauge name to `flows@lateboof.com` **from an InReach**, confirm the
flow comes back to the device.

## Not in scope (v1)

SMS / iPhone-satellite (v2 — the reply path there is clean SMS, no web form), Magpie
(Quebec CEHQ), runnable-judgment, fuzzy/LLM name matching, saved gauges, caching.
