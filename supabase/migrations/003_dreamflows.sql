-- Add 'dreamflows' as a valid gauge source (virtual gauges via dreamflows.com).
alter table gauges drop constraint if exists gauges_source_check;
alter table gauges add constraint gauges_source_check
  check (source in ('usgs', 'wsc', 'cdec', 'dreamflows'));
