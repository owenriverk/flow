-- Track the previous reading so the UI can show a rising/falling trend arrow.
-- prev_discharge/prev_reading_time hold whatever discharge was in the row
-- before the current refresh-gauges write (carried forward across cycles
-- where the new reading failed, so a brief outage doesn't erase the trend).
alter table gauges add column if not exists prev_discharge numeric;
alter table gauges add column if not exists prev_reading_time timestamptz;
