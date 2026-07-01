-- Add 'noaa' as a valid gauge source (NOAA NWPS stageflow API — e.g. Tatshenshini).
--
-- The live database has accepted 'noaa' since the NOAA adapter shipped (see
-- src/aliases.json and supabase/functions/refresh-gauges/gauges.ts, both of which
-- already reference source: 'noaa'), but no migration ever recorded that change —
-- it was applied directly against the live schema and never checked in. This
-- migration brings supabase/migrations/ back in sync with reality so replaying it
-- against a fresh project reproduces the actual current schema.
alter table gauges drop constraint if exists gauges_source_check;
alter table gauges add constraint gauges_source_check
  check (source in ('usgs', 'wsc', 'cdec', 'dreamflows', 'noaa'));
