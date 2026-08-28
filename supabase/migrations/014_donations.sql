-- 014: donations behind lateboof.com/support — the goal bar and the supporters
-- list read from here, and the Stripe webhook (web/functions/api/stripe-webhook.ts)
-- writes here.
--
-- Trust model is the OPPOSITE of query_log / sms_optin: the browser can neither
-- insert nor read this table. An anon insert policy would let anyone with the
-- public key put a name on the supporters list for free, so writes come only
-- from the webhook (service role, Pages secret) and from hand entry in the SQL
-- editor for River / Title sponsors who pay by invoice. Reads come through two
-- views that expose names and a season total — never per-person amounts, never
-- emails.
--
-- Apply manually: paste into the Supabase SQL editor (repo convention).

create table if not exists donations (
  id                bigint generated always as identity primary key,
  stripe_session_id text unique,                   -- null for hand-entered sponsors
  tier              text not null default 'paddler'
                    check (tier in ('paddler', 'river', 'title')),
  amount_cents      integer not null check (amount_cents >= 0),
  currency          text not null default 'usd',
  display_name      text,                          -- what shows on /support; null = anonymous
  river_name        text,                          -- river sponsors only, e.g. 'Middle Fork Salmon'
  season            text not null default '2027',
  approved          boolean not null default true, -- false hides a name without deleting the record
  email             text,                          -- Stripe receipt address; never exposed
  created_at        timestamptz not null default now()
);

create index if not exists donations_season_idx on donations (season, created_at desc);

alter table donations enable row level security;
revoke all on donations from anon, authenticated;
-- deliberately NO policies: service role only.

-- Public views. The default security_invoker = false is the point: the view runs
-- as its owner and bypasses donations' RLS, but only these columns get out.
create or replace view supporters_public as
  select tier, display_name, river_name, season, created_at
  from donations
  where approved
    and display_name is not null
    and display_name <> '';

-- The webhook stores the price-currency (USD) figure even when Adaptive
-- Pricing showed the donor CAD, so every row should be usd. The filter is a
-- safety net: a stray non-USD row can never inflate the goal bar.
create or replace view donation_totals as
  select season,
         count(*)::int                    as donations,
         coalesce(sum(amount_cents) filter (where currency = 'usd'), 0)::bigint as raised_cents
  from donations
  group by season;

grant select on supporters_public to anon, authenticated;
grant select on donation_totals   to anon, authenticated;

-- Hand-entering a River or Title sponsor who paid by invoice:
--   insert into donations (tier, amount_cents, display_name, river_name, season)
--   values ('river', 5000, 'Canyon REO', 'Grand Canyon', '2027');
-- Hiding a name without losing the record:
--   update donations set approved = false where id = 42;
