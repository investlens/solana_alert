-- ============================================================
-- AlphaOS Phase 2
-- Opportunity Intelligence Upgrade
--
-- Extends the EXISTING opportunities table.
-- Does not recreate or replace existing functionality.
-- ============================================================

alter table public.opportunities
  add column if not exists strategy_key text,
  add column if not exists recommended_action text,
  add column if not exists why text,
  add column if not exists what_happened text,
  add column if not exists invalidation text,
  add column if not exists risk_reason text,
  add column if not exists last_observed_at timestamptz,
  add column if not exists observation_count integer not null default 1,
  add column if not exists expires_at timestamptz;

-- ------------------------------------------------------------
-- Strategy integrity
--
-- Keep this as a normal FK to the EXISTING strategy_registry.
-- Every strategy-tagged opportunity must point to a registered
-- AlphaOS strategy.
-- ------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'opportunities_strategy_key_fkey'
  ) then
    alter table public.opportunities
      add constraint opportunities_strategy_key_fkey
      foreign key (strategy_key)
      references public.strategy_registry(strategy_key)
      on update cascade
      on delete set null;
  end if;
end
$$;

-- ------------------------------------------------------------
-- Allowed actionable AlphaOS responses
-- ------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'opportunities_recommended_action_check'
  ) then
    alter table public.opportunities
      add constraint opportunities_recommended_action_check
      check (
        recommended_action is null
        or recommended_action in (
          'BUY',
          'CHECK_ENTRY',
          'TRACK',
          'WATCH',
          'ADD_TO_WATCHLIST',
          'OPEN_TOKEN',
          'EXIT',
          'IGNORE'
        )
      );
  end if;
end
$$;

-- ------------------------------------------------------------
-- Useful indexes for the future Web Terminal / API
-- ------------------------------------------------------------

create index if not exists opportunities_strategy_key_idx
  on public.opportunities(strategy_key);

create index if not exists opportunities_chain_strategy_idx
  on public.opportunities(chain, strategy_key);

create index if not exists opportunities_asset_strategy_idx
  on public.opportunities(asset_id, strategy_key);

create index if not exists opportunities_status_updated_idx
  on public.opportunities(status, updated_at desc);

create index if not exists opportunities_last_observed_idx
  on public.opportunities(last_observed_at desc);

-- ------------------------------------------------------------
-- Backfill existing rows safely.
-- There are currently zero rows, but this keeps the migration
-- safe if another environment already contains opportunities.
-- ------------------------------------------------------------

update public.opportunities
set
  last_observed_at = coalesce(last_observed_at, created_at),
  observation_count = coalesce(observation_count, 1)
where
  last_observed_at is null
  or observation_count is null;
