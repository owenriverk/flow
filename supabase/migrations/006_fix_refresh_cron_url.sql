-- 002_schedule.sql was checked in with a literal 'YOUR_PROJECT_ID' placeholder that
-- was never replaced in the repo (it was corrected directly against the live cron
-- job instead, the same kind of out-of-band fix as 005_noaa_source.sql). Re-issuing
-- cron.schedule with the same job name replaces the existing job definition, so this
-- is safe to run regardless of what the live job currently points at.
select cron.schedule(
  'refresh-gauges',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://vfkoegvzllxvshcnfbox.supabase.co/functions/v1/refresh-gauges',
    headers := '{"Content-Type": "application/json"}'::jsonb
  )
  $$
);
