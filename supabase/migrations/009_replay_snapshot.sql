-- 009: night-over-night state for the CI query-replay job (scripts/replay.ts,
-- run by .github/workflows/canary.yml with the SERVICE-ROLE key).
--
-- One jsonb row: { resolutions: {query -> "source:site" | null}, digestLastSent }.
-- RLS is enabled with NO policies on purpose — the anon key (public, committed
-- in this repo) can neither read nor write this table; only the service role
-- (held in GitHub Actions secrets) can. Do not add an anon policy.
--
-- Apply manually: paste into the Supabase SQL editor (repo convention).

create table if not exists replay_snapshot (
  id         int primary key default 1 check (id = 1),
  snapshot   jsonb not null,
  updated_at timestamptz not null default now()
);

alter table replay_snapshot enable row level security;
