-- ============================================================
-- AlphaOS Phase 2
-- Opportunity Delivery Persistence
--
-- Records which strategy opportunities were delivered to which
-- Telegram users.
--
-- Separate from legacy alert_deliveries because opportunities
-- are a distinct intelligence product from legacy alerts.
-- ============================================================

create table if not exists public.opportunity_deliveries (
  id bigserial primary key,

  opportunity_id bigint not null
    references public.opportunities(id)
    on delete cascade,

  telegram_id text not null,

  strategy_key text
    references public.strategy_registry(strategy_key)
    on update cascade
    on delete set null,

  chain text,

  recommended_action text,

  tier_at_delivery text,

  delivery_channel text not null default 'telegram',

  delivered_at timestamptz not null default now(),

  created_at timestamptz not null default now(),

  metadata jsonb not null default '{}'::jsonb,

  constraint opportunity_deliveries_unique_user
    unique (
      opportunity_id,
      telegram_id,
      delivery_channel
    ),

  constraint opportunity_deliveries_action_check
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
    ),

  constraint opportunity_deliveries_tier_check
    check (
      tier_at_delivery is null
      or tier_at_delivery in (
        'admin',
        'paid',
        'free'
      )
    )
);

create index if not exists
  opportunity_deliveries_opportunity_idx
  on public.opportunity_deliveries(opportunity_id);

create index if not exists
  opportunity_deliveries_telegram_idx
  on public.opportunity_deliveries(telegram_id);

create index if not exists
  opportunity_deliveries_strategy_idx
  on public.opportunity_deliveries(strategy_key);

create index if not exists
  opportunity_deliveries_delivered_at_idx
  on public.opportunity_deliveries(delivered_at desc);

comment on table public.opportunity_deliveries is
  'AlphaOS Phase 2 per-user opportunity delivery history and deduplication.';
