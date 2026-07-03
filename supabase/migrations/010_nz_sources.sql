-- Add 'envdata' (Environment Southland telemetry, NZ) and 'flowrate' (flowrate.co.nz,
-- NZ) as valid gauge sources — see src/envdata.ts and src/flowrate.ts.
alter table gauges drop constraint if exists gauges_source_check;
alter table gauges add constraint gauges_source_check
  check (source in ('usgs', 'wsc', 'cdec', 'dreamflows', 'noaa', 'envdata', 'flowrate'));
