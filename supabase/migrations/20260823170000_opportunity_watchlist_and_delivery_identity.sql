-- AlphaOS Phase 1 product-integrity hardening.
--
-- Watchlist membership is deliberately separate from notification delivery.
create table if not exists public.user_opportunity_watchlist (
  id bigserial primary key,
  telegram_id text not null,
  opportunity_id bigint not null
    references public.opportunities(id)
    on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_opportunity_watchlist_unique
    unique (telegram_id, opportunity_id)
);

create index if not exists user_opportunity_watchlist_telegram_idx
  on public.user_opportunity_watchlist(telegram_id, created_at desc);

create index if not exists user_opportunity_watchlist_opportunity_idx
  on public.user_opportunity_watchlist(opportunity_id);

comment on table public.user_opportunity_watchlist is
  'Per-user opportunity watchlist. Never used for notification deduplication.';

-- Preserve watchlist choices made before watchlist state was separated from
-- the legacy delivery metadata.
insert into public.user_opportunity_watchlist (
  telegram_id,
  opportunity_id,
  created_at,
  updated_at
)
select
  telegram_id,
  opportunity_id,
  coalesce(created_at, now()),
  now()
from public.opportunity_deliveries
where metadata ->> 'tracked' = 'true'
on conflict (telegram_id, opportunity_id) do nothing;

-- A delivery identity represents one meaningful opportunity lifecycle state.
-- Existing rows are backfilled so production delivery history remains valid.
alter table public.opportunity_deliveries
  add column if not exists delivery_identity text;

update public.opportunity_deliveries
set delivery_identity = concat(
  'v1:',
  upper(coalesce(recommended_action, 'UNKNOWN')),
  ':NEW'
)
where delivery_identity is null;

alter table public.opportunity_deliveries
  alter column delivery_identity set not null;

alter table public.opportunity_deliveries
  drop constraint if exists opportunity_deliveries_unique_user;

alter table public.opportunity_deliveries
  add constraint opportunity_deliveries_unique_state
  unique (
    opportunity_id,
    telegram_id,
    delivery_channel,
    delivery_identity
  );

create index if not exists opportunity_deliveries_identity_idx
  on public.opportunity_deliveries(
    opportunity_id,
    telegram_id,
    delivery_identity
  );

comment on column public.opportunity_deliveries.delivery_identity is
  'Stable identity for a meaningful action/lifecycle state, used for restart-safe deduplication.';
