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
  replyToInreach.ts  reply via Garmin's web reply page (GET token page -> find Server Action -> POST)
  lookupGauge.ts     text -> { site, source, name?, location? } | null  (aliases + raw id)
  usgs.ts            USGS IV API (native cfs/ft), typed errors, 8s timeout
  wsc.ts             Water Survey of Canada (native cms/m), 8s timeout
  cdec.ts            California CDEC (native cfs/ft, per-station sensor/dur)
  errors.ts          shared GaugeError { kind: not_found | unavailable }
  time.ts            upstream timestamp -> { instant, utc offset }
  formatReply.ts     reading -> <=160 char reply, flow value never truncated
  handleQuery.ts     channel-agnostic core: text in, reply out, routes by source, never throws
  aliases.json       ~40 curated runs -> gauge (US/Canada/NZ/CA class V)
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

Live test: send a gauge name to `flow@lateboof.com` **from an InReach**, confirm the
flow comes back to the device.

## Implemented beyond v1

Fuzzy/LLM name matching (`src/aiResolve.ts` — Workers AI, gated by a daily call budget
that is split per ingress so one channel can't starve another, only fires on a lookup
miss, and can only ever resolve to a real alias key or nothing)
and a last-known-good cache fallback via Supabase (`src/supabaseCache.ts`, used when
the live upstream API is down) both shipped after v1. There's also a companion
gauge-directory website (`web/`) backed by a Supabase cron refresher — see `supabase/`.

## SMS (public since 2026-08-28)

Toll-free **+1 (866) 284-5181** answers the same queries from any US/Canada phone,
including iPhone satellite messaging where the carrier supports SMS over satellite.
`POST /api/sms` (Twilio webhook, signature-validated) → `handleQuery` → TwiML reply.
Guards: replay dedup on MessageSid, per-sender throttle (10/hr, 300/month),
per-ingress AI budget, Cloudflare rate limit on the route, STOP/HELP handled by
Twilio. Program terms at lateboof.com/sms. Twilio account is prepaid by design —
the balance is the only hard spending cap.

## Not in scope

Magpie (Quebec CEHQ), saved gauges, and Tier-2 flow *alerts* (outbound push). Runnable-judgment is not part of the satellite reply
itself (it's always raw numbers) — the website's color-coded ranges are a separate,
browsable feature, not something the bot ever texts back.
