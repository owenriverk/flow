-- SMS consent log for lateboof.com/sms (Twilio toll-free verification requires
-- a timestamped record of opt-in). Same trust model as query_log (migration
-- 007): the browser may INSERT a consent record with the anon key; nothing
-- public can ever SELECT one. Phone numbers are PII — reads happen only in
-- the Supabase dashboard or with the service role.
create table if not exists sms_optin (
  id           bigint generated always as identity primary key,
  phone        text        not null,
  source       text        not null default 'lateboof.com/sms',
  consented_at timestamptz not null default now()
);

alter table sms_optin enable row level security;

create policy "anon can record consent"
  on sms_optin for insert
  to anon
  with check (true);
-- deliberately NO select/update/delete policies for anon
