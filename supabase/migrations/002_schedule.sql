-- Schedule the refresh-gauges Edge Function to run every 15 minutes
--
-- IMPORTANT: This migration must be run AFTER:
-- 1. Enabling the pg_cron extension in the Supabase dashboard:
--    Database → Extensions → Search "pg_cron" → Enable
-- 2. Enabling the pg_net extension in the Supabase dashboard:
--    Database → Extensions → pg_net → Enable
--    (required because net.http_post depends on it)
-- 3. Deploying the refresh-gauges Edge Function (Task 3)
--
-- To run this: paste this SQL into the Supabase SQL Editor and execute it.

select cron.schedule(
  'refresh-gauges',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/refresh-gauges',
    headers := '{"Content-Type": "application/json"}'::jsonb
  )
  $$
);

-- NOTE: Replace YOUR_PROJECT_ID with your actual Supabase project ID
-- (visible in your Supabase dashboard URL: https://supabase.com/dashboard/project/YOUR_PROJECT_ID)

-- Verification query (commented out):
-- select jobname, schedule, active from cron.job;
-- Expected result: one row with jobname='refresh-gauges', schedule='*/15 * * * *', active=true
