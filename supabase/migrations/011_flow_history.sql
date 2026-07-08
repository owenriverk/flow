-- v3 trend arrows: flow_history + derived baseline columns (design doc
-- owen-main-design-20260706-104500.md, eng-review Issue 5A).
--
-- flow_history is a short-window discharge series so the trend arrow can
-- compare against ~24h ago — same-time-of-day comparison cancels the diurnal
-- melt cycle, so the arrow reads day-over-day ("is it coming in"), not the
-- morning-vs-evening-peak swing. Written and read ONLY by the refresh-gauges
-- edge function (service role); no anon policies on purpose — the site reads
-- the derived baseline_* columns on the gauges row instead. Retention (48h)
-- is enforced by the function each run.
create table if not exists flow_history (
  key          text        not null,
  discharge    numeric     not null,
  reading_time timestamptz not null,
  primary key (key, reading_time)
);

create index if not exists flow_history_key_time_desc
  on flow_history (key, reading_time desc);

-- RLS on with zero policies: anon/authenticated read nothing; the service
-- role bypasses RLS. (Sparkline revival someday = add an anon select policy
-- and raise the retention constant — nothing else.)
alter table flow_history enable row level security;

-- The trend baseline the site renders. Contract separation, on purpose:
--   prev_*     = the bot's last-known-good outage fallback (migration 004,
--                semantics UNCHANGED by this migration)
--   baseline_* = the site's ~24h-ago trend comparison point
alter table gauges add column if not exists baseline_discharge numeric;
alter table gauges add column if not exists baseline_reading_time timestamptz;
