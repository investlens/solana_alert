-- ALPHAOS LIVE TRACK V1 is additive and does not participate in alert/outcome
-- qualification or execution. All access is server-side through service_role.
create table if not exists public.alpha_live_track_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  chain text not null check (chain in ('solana', 'robinhood')),
  token_address text not null,
  opportunity_id bigint references public.opportunities(id) on delete set null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'STOPPED', 'EXPIRED', 'INVALIDATED')),
  telegram_chat_id text not null,
  telegram_message_id bigint,
  baseline jsonb not null,
  latest jsonb not null,
  peak jsonb not null default '{}'::jsonb,
  next_update_at timestamptz not null default now(),
  last_observed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists alpha_live_track_due_idx
  on public.alpha_live_track_sessions(status, next_update_at)
  where status = 'ACTIVE';
create index if not exists alpha_live_track_user_token_idx
  on public.alpha_live_track_sessions(user_id, chain, token_address, started_at desc);
create unique index if not exists alpha_live_track_one_active_idx
  on public.alpha_live_track_sessions(user_id, chain, token_address)
  where status = 'ACTIVE';

create table if not exists public.alpha_live_track_observations (
  id bigserial primary key,
  session_id uuid not null references public.alpha_live_track_sessions(id) on delete cascade,
  observed_at timestamptz not null default now(),
  elapsed_seconds integer not null check (elapsed_seconds >= 0),
  snapshot jsonb not null,
  source_freshness jsonb not null default '{}'::jsonb
);
create index if not exists alpha_live_track_observation_timeline_idx
  on public.alpha_live_track_observations(session_id, observed_at);

create table if not exists public.alpha_live_track_transitions (
  id bigserial primary key,
  session_id uuid not null references public.alpha_live_track_sessions(id) on delete cascade,
  transition_key text not null,
  transition_type text not null,
  observed_at timestamptz not null default now(),
  snapshot jsonb not null default '{}'::jsonb,
  telegram_message_id bigint,
  unique(session_id, transition_key)
);

alter table public.alpha_live_track_sessions enable row level security;
alter table public.alpha_live_track_observations enable row level security;
alter table public.alpha_live_track_transitions enable row level security;
revoke all on table public.alpha_live_track_sessions, public.alpha_live_track_observations,
  public.alpha_live_track_transitions from public, anon, authenticated;
grant select, insert, update, delete on table public.alpha_live_track_sessions to service_role;
grant select, insert on table public.alpha_live_track_observations, public.alpha_live_track_transitions to service_role;
grant usage, select on sequence public.alpha_live_track_observations_id_seq,
  public.alpha_live_track_transitions_id_seq to service_role;

comment on table public.alpha_live_track_sessions is
  'Temporary per-user/token intelligence sessions; isolated from immutable alert outcomes and trading.';
comment on table public.alpha_live_track_observations is
  'Live Track learning timeline used for 30s/1m/3m/5m/15m retrospective analysis.';
