# Flow

A river-gauge bot for whitewater paddlers. Text a run name to **866-284-5181**
from a Garmin inReach or any phone — or email `flow@lateboof.com` from an
inReach — and the live gauge reading comes back in one message. Free, no app,
no account.

See [DESIGN.md](./DESIGN.md) for the original design (with dated addenda),
[RUNS.md](./RUNS.md) for the run roster, [docs/SELF-CHECKING.md](./docs/SELF-CHECKING.md)
for how it watches itself, and [web/DEPLOY.md](./web/DEPLOY.md) for the website.

## Status (2026-08-30)

**Live in production on both channels.** Email/inReach since 2026-06-28 (reply
path verified on a real device; re-verified 2026-08-26 after Garmin moved their
reply page). SMS public since 2026-08-28, including inReach-via-SMS through
Garmin's relay. 45 gauges, ~150 curated phrases, US/Canada/NZ. Nightly
self-checks with a public status page (lateboof.com/status), a live gauge
directory (lateboof.com), come-in forecasts (lateboof.com/forecast, built by the
companion `weth` repo), and a donations page (lateboof.com/support, Stripe →
Supabase).

```
src/
  worker.ts          Cloudflare Worker entry: email() for inReach/email ingress, fetch() for /api/sms + status
  handleInbound.ts   email glue: parseInbound -> handleQuery -> replyToInreach
  parseInbound.ts    inReach email body -> { query, reply token }
  replyToInreach.ts  reply via Garmin's messenger page (GET token page -> find Server Action -> POST)
  sms.ts             Twilio adapter: signature check, replay dedup, relay-footer strip, TwiML
  smsThrottle.ts     per-sender caps (10/hr, 300/mo; 6x for pooled inReach gateway numbers)
  spamFilter.ts      keeps spam-shaped email out of failure stats
  lookupGauge.ts     text -> gauge ref. Tiers: exact alias / raw USGS+WSC id / phrase / word-set;
                     refuses two-river asks and ambiguity instead of guessing (see test/exhaustive.test.ts)
  aiResolve.ts       last-resort fuzzy matcher (Workers AI); budgeted per ingress, can only
                     return a real alias key or nothing
  handleQuery.ts     channel-agnostic core: text in, reply out, routes by source, never throws
  usgs.ts wsc.ts cdec.ts dreamflows.ts noaa.ts envdata.ts flowrate.ts   per-source fetchers, native units
  supabaseCache.ts   last-known-good fallback when an upstream API is down
  formatReply.ts     reading -> <=160 char reply, flow value never truncated
  budget.ts          daily AI-call budget, split per ingress
  queryLog.ts        fire-and-forget query telemetry (Supabase, insert-only)
  statusTracking.ts  per-channel success/failure state behind /api/status
  canaryRunner/Sweep/Garmin/Helpers.ts   nightly self-checks (docs/SELF-CHECKING.md)
  replayLogic.ts     nightly deterministic re-resolution of the real query corpus (CI)
  stripeWebhook.ts   donation webhook verification/mapping (used by web/functions/)
  aliases.json       ~150 curated phrases -> 45 gauges; provenance.json is the audit trail
```

## Develop

```bash
npm install
npm test                 # vitest — 469 tests, offline, fast
npm run typecheck        # tsc --noEmit
LIVE=1 npx vitest run test/live.test.ts     # hits the real gauge APIs
LIVE=1 npx vitest run test/phrases.test.ts  # full phrase corpus against live APIs
EXHAUSTIVE=1 npx vitest run test/exhaustive.test.ts
    # the resolver acceptance gate: ~137k generated queries (every alias pair x
    # six joiners, punctuation, junk), 8 invariants, all must hold at zero.
    # Run it for ANY change to lookupGauge.ts or aliases.json. ~3s.
```

## Deploy

Three deployables; nothing deploys automatically except the website.

```bash
npx wrangler deploy      # the bot Worker (email + SMS + nightly cron)
git push                 # web/** changes -> Cloudflare Pages via deploy-pages.yml
supabase functions deploy refresh-gauges --project-ref vfkoegvzllxvshcnfbox --no-verify-jwt
                         # the website's gauge refresher (run after editing gauges.ts)
```

The Oracle forecast pages under `web/forecast*` are build outputs of the private
`weth` repo — edit them there (`mock/build_mock.py`), never here.

## Guardrails worth knowing before changing anything

- The reply is a raw reading, never a runnable judgment — the website colors
  ranges, the bot does not.
- Every message gets a reply; on a satellite link, silence wastes the paddler's
  credit.
- A message naming two different rivers is refused, not half-answered.
- Every gauge addition needs a `src/provenance.json` entry (enforced by an
  inverted ratchet in `test/provenance.test.ts`) and must pass the exhaustive
  resolver gate.

## SMS (public since 2026-08-28)

Toll-free **+1 (866) 284-5181** answers the same queries from a Garmin inReach (via
Garmin's SMS relay) or any US/Canada phone, including iPhone satellite messaging where
the carrier supports SMS over satellite. inReach-relayed texts are recognized by the
`inreachlink.com` footer (stripped before lookup) and get a larger throttle bucket,
since Garmin's gateway numbers are pooled across devices.
`POST /api/sms` (Twilio webhook, signature-validated) → `handleQuery` → TwiML reply.
Guards: replay dedup on MessageSid, per-sender throttle (10/hr, 300/month),
per-ingress AI budget, Cloudflare rate limit on the route, STOP/HELP handled by
Twilio. Program terms at lateboof.com/sms. Twilio account is prepaid by design —
the balance is the only hard spending cap.

## Not in scope

Magpie (Quebec CEHQ), saved gauges, and Tier-2 flow *alerts* (outbound push). Runnable-judgment is not part of the satellite reply
itself (it's always raw numbers) — the website's color-coded ranges are a separate,
browsable feature, not something the bot ever texts back.
