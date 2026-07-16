-- 013: add 'sms' to the query_log channel CHECK.
--
-- The v2 SMS adapter (src/worker.ts fetch() /api/sms + src/sms.ts) logs inbound
-- texts with channel 'sms', the same way the InReach/email paths log theirs.
-- Migration 007/008's CHECK would silently reject those rows (logQuery swallows
-- errors by design — src/queryLog.ts), so the constraint must be recreated first.
-- Land this BEFORE pointing the Twilio webhook at the Worker, or SMS queries go
-- unlogged.
--
-- Apply manually: paste into the Supabase SQL editor (same convention as
-- 002_schedule.sql / 008_canary_channel.sql). If the DROP fails, the constraint
-- name differs — find it with:
--   select conname from pg_constraint where conrelid = 'query_log'::regclass;

alter table query_log drop constraint if exists query_log_channel_check;
alter table query_log add constraint query_log_channel_check
  check (channel in ('inreach', 'email', 'sms', 'none', 'canary'));
