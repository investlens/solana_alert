create table if not exists public.x_reputed_accounts (
  id bigserial primary key,
  handle text not null,
  display_name text,
  enabled boolean not null default true,
  tier text not null default 'WATCH',
  source text not null,
  source_rank integer,
  source_metrics jsonb not null default '{}'::jsonb,
  notes text,
  added_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint x_reputed_accounts_handle_normalized check (
    handle = lower(handle)
    and handle !~ '^@'
    and handle ~ '^[a-z0-9_]{1,15}$'
  ),
  constraint x_reputed_accounts_tier_check check (
    tier in ('HIGH_ALPHA', 'REPUTED', 'WATCH')
  ),
  constraint x_reputed_accounts_source_rank_check check (
    source_rank is null or source_rank > 0
  )
);

create unique index if not exists x_reputed_accounts_handle_ci_unique
  on public.x_reputed_accounts (lower(handle));

create index if not exists x_reputed_accounts_enabled_tier_idx
  on public.x_reputed_accounts (enabled, tier, handle);

alter table public.x_reputed_accounts enable row level security;
revoke all on table public.x_reputed_accounts from anon, authenticated;
grant select, insert, update, delete on table public.x_reputed_accounts to service_role;
grant usage, select on sequence public.x_reputed_accounts_id_seq to service_role;

create policy x_reputed_accounts_service_role_all
  on public.x_reputed_accounts
  for all
  to service_role
  using (true)
  with check (true);

insert into public.strategy_registry (
  strategy_key, name, description, chain, category, enabled,
  user_visible, default_user_enabled, execution_mode, default_action,
  priority, config
)
values (
  'X_REPUTED_MENTION', 'Reputed X Mention',
  'Informational mention of a verified Robinhood contract by an enabled reputed-account watchlist entry.',
  'robinhood', 'intelligence', true, true, false, 'manual', 'WATCH', 40,
  '{"user_facing":true,"trading":false,"monitoring_enabled":false}'::jsonb
)
on conflict (strategy_key) do update set
  name = excluded.name,
  description = excluded.description,
  chain = excluded.chain,
  category = excluded.category,
  enabled = excluded.enabled,
  user_visible = excluded.user_visible,
  default_user_enabled = excluded.default_user_enabled,
  execution_mode = excluded.execution_mode,
  default_action = excluded.default_action,
  priority = excluded.priority,
  config = excluded.config,
  updated_at = now();

comment on table public.x_reputed_accounts is
  'Admin-managed initial reputed-account watchlist for the disabled-by-default X Intelligence foundation.';
