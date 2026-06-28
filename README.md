# Flow

A satellite-text river-gauge bot for whitewater kayakers. Text a gauge name from a
Garmin InReach (no cell signal needed) and get the current USGS flow back.

See [DESIGN.md](./DESIGN.md) for the full design and the /plan-eng-review notes.

## Status

**Core logic: built and fully tested. Email transport: not yet wired** (waiting on a
real Garmin email sample — see "Next" below).

```
src/
  lookupGauge.ts   text -> { site, source, name?, location? } | null  (aliases + raw USGS/WSC id)
  usgs.ts          fetch + parse USGS IV API (native cfs/ft), typed errors, 8s timeout
  wsc.ts           fetch + parse Water Survey of Canada (native cms/m), 8s timeout
  cdec.ts          fetch + parse California CDEC (native cfs/ft, per-station sensor/dur)
  errors.ts        shared GaugeError { kind: not_found | unavailable }
  time.ts          upstream timestamp -> { instant, utc offset }
  formatReply.ts   reading -> <=160 char reply, flow value never truncated
  handleQuery.ts   channel-agnostic core: text in, reply out, routes by source, never throws
  aliases.json     ~35 curated runs -> gauge (VERIFY each id before trusting)
```

## Develop

```bash
npm install
npm test            # vitest, 29 tests
npm run typecheck   # tsc --noEmit
```

## Next (in order)

1. **Verify the InReach email round trip** — send from a device to an inbox you control,
   reply, confirm it lands on the device. This is the assumption everything rests on.
2. **Capture a real Garmin email** (raw source). The body footer/format is unknown, so
   `parseInbound` will be TDD'd against that real sample, not a guess.
3. **Wire the Cloudflare Email Worker** (`email()` handler) calling `handleQuery`.
4. **Verify every `aliases.json` site id** against USGS before relying on it — wrong ids
   in a safety tool are worse than a missing run.

## Not in scope (v1)

SMS / iPhone-satellite (v2), Magpie (Quebec CEHQ — needs a third adapter),
runnable-judgment, fuzzy matching, saved gauges, caching.
