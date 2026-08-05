# TODOs

## Stikine watch-list alerts through the bot (InReach push)

- **What:** Subscription-style alert — a paddler texts `watch stikine` from an
  InReach; the bot pushes a message when the basin instruments spike (tributary
  rise / main-stem trend toward a reclose).
- **Why:** The person who needs a reclose warning is at the put-in or in the
  canyon with no internet — the planner page can't reach them; the bot already
  can. Identified by the outside-voice review of the Stikine Hindcast design
  (2026-07-06, T4).
- **Where to start:** `handleQuery` is channel-agnostic; this needs a watch-list
  store (KV/Supabase), a cron check against the same GeoMet queries the planner
  page uses, and an outbound-initiated reply path (the hard part — today the bot
  only replies to inbound tokens).
- **Blocked by:** the v2-whistles trigger (one clean month of v1.5 self-checking
  + gauge audit complete) — same gate as SMS below.
- **Effort:** L (human) → M with CC. **Priority:** P3.

## Stikine time machine (season replay scrubber)

- **What:** A scrubber over the recorded seasons (1954→) replaying the whole
  instrument panel — main stem, tributaries, and what the Oracle's call would
  have said that morning. Approach C of the 2026-07-06 office-hours session;
  mock at `~/.gstack/projects/owenriverk-flow/designs/stikine-mocks.html`.
- **Why:** Every historical reclose becomes a watchable story; strong material
  for the Stikine-watch newsletter issue. Pre-baked JSON frames keep it static
  and $0/mo.
- **Depends on:** the Stikine Hindcast dataset (event extractor + per-season
  masks) — dramatically cheaper once that ships. Design doc:
  `~/.gstack/projects/owenriverk-flow/owen-main-design-20260706-114735.md`.
- **Effort:** ~2 weekends now → less after the Hindcast. **Priority:** P3.

## MODIS melt-out vs opening-date scatter

- **What:** Use NASA's daily 500 m snow-cover record (NSIDC MOD10A1 /
  Worldview, 2000→) to date the upper basin's melt-out each year; scatter
  against the 26 opening dates since 2000.
- **Why:** Answers "does melt-out timing predict the opening?" — a documented
  yes or no either way fits the project's we-checked credibility; a yes gives
  the April outlook newsletter a spring leading indicator. (Snow SWE famously
  didn't help the flow model; melt-out *date* is a different question.)
- **Where to start:** NSIDC MOD10A1 granules or Worldview snapshots for the
  upper Stikine bbox; define melt-out as first day basin snow fraction < X%.
- **Depends on:** nothing from the Hindcast release. **Effort:** S/M research
  weekend. **Priority:** P3.

## Revisit v2 whistles (SMS / iPhone-satellite first)

- **What:** Re-open the deferred feature list. Leading candidate: SMS via Twilio,
  which unlocks iPhone satellite messaging and doubles as the fallback if Garmin
  changes their reply web form.
- **Trigger (both must hold):** v1.5 self-checking has run **one month with no
  false-alarm week**, AND the gauge audit is complete (`MAX_UNAUDITED === 0` in
  `test/provenance.test.ts`).
- **Why deferred:** decided in the 2026-07-01 /office-hours session — nail down
  core trust before adding capability. See
  `~/.gstack/projects/owenriverk-flow/owen-main-design-20260701-142656.md` and
  DESIGN.md ("NOT in scope") for the v2 shape and the reasoning.
- **Where to start:** `handleQuery` is already channel-agnostic; SMS is a new
  adapter beside the email one in `src/worker.ts`, plus Twilio webhook signature
  validation and A2P/toll-free registration (the real cost — research first).
- **Status (2026-07-15):** Tier-1 SMS gauge replies (transactional "text a run
  name, get one reply") BUILT on `feat/sms-twilio` — a signature-validated
  `POST /api/sms` webhook, verified live in `wrangler dev` (accept/reject + a real
  USGS reply). Toll-free number 866-284-5181 provisioned; verification submitted.
  NOT public: still gated on the trigger above, and personal-number testing only.
  Deploy steps before any real use: `wrangler secret put TWILIO_AUTH_TOKEN`, apply
  `supabase/migrations/013_sms_channel.sql`, point the Twilio webhook at
  `https://lateboof.com/api/sms`. Tier-2 flow **alerts** (outbound push) not built.
- **Harden before public launch** (from the 2026-07-15 pre-landing + adversarial
  review; all accepted for personal testing, revisit before opening to strangers):
  a Cloudflare rate-limit/WAF rule on `/api/sms` (it parses the body pre-auth);
  replay-dedup on Twilio `MessageSid` via short-TTL KV; and a per-channel AI budget
  so SMS gibberish can't drain the shared daily fuzzy-match budget email/InReach use.

## Searchable AKAs on the web gauge table

- **What:** Let the directory search match alias phrases, not just name/location/
  text_key — searching "the box" should find Clarks Fork (the Box).
- **Why:** The bot accepts ~113 phrases but the website only searches 40 display
  names; paddlers who know a run by slang can't find its row.
- **Where to start:** add an `aliases text[]` column to the `gauges` table,
  populate it in `refresh-gauges` from a per-key phrase list, include it in the
  `gauges.js` filter.
- **Effort:** M (human) → S with CC. **Priority:** P3.

## RUNS.md generator script

- **What:** Generate RUNS.md's tables from `src/aliases.json` +
  `supabase/functions/refresh-gauges/gauges.ts` instead of hand-editing.
- **Why:** RUNS.md drifted twice within days (Tatshenshini gauge id, missing
  SF Flathead row) — hand-sync loses. The new `test/nameConsistency.test.ts`
  guards the two config files against each other, but RUNS.md stays manual.
- **Effort:** S/M. **Priority:** P3. **Blocked by:** nothing.

## GPS-assisted disambiguation fallback

- **What:** Use the coordinates InReach messages carry to break ties between
  similarly named runs (e.g. bare "salmon" from a device sitting at MF Lodge).
- **Why:** Roster is capped at ~150-200 rivers on AI/fuzzy accuracy estimates
  (2026-07-04 decision); location is the strongest untapped disambiguation
  signal as the roster grows toward that cap.
- **Where to start:** `parseInbound.ts` already sees the full email — check
  whether Garmin includes a location line/URL; map to nearest roster gauges.
- **Effort:** L (human) → M with CC. **Priority:** P3.
