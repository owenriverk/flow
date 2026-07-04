# TODOs

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
