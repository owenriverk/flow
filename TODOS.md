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
