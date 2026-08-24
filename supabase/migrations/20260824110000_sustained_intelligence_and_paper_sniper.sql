-- Additive sustained-intelligence vocabulary and PAPER-only future sniper configuration.
alter table public.alpha_alert_events add column if not exists intelligence_state text;
alter table public.alpha_alert_events add column if not exists semantic_event_type text;
alter table public.alpha_alert_events drop constraint if exists alpha_alert_events_action_check;
alter table public.alpha_alert_events add constraint alpha_alert_events_action_check check (
  lifecycle_action in ('BUY','CHECK_ENTRY','EXIT','AVOID','OBSERVE','TRACK')
);
alter table public.alpha_alert_events add constraint alpha_alert_events_intelligence_state_check check (
  intelligence_state is null or intelligence_state in ('DISCOVERED','FORMING','BUILDING','CONFIRMED','RUNNER','COOLING','WEAKENING','DANGER')
);
create index if not exists alpha_alert_events_semantic_type_time_idx
  on public.alpha_alert_events(semantic_event_type, alerted_at desc);

create table if not exists public.user_paper_sniper_configs (
  id bigserial primary key,
  telegram_id text not null unique,
  enabled boolean not null default false,
  mode text not null default 'PAPER' check (mode = 'PAPER'),
  amount_usd numeric not null default 10 check (amount_usd > 0),
  max_valuation_usd numeric,
  minimum_liquidity_usd numeric,
  acceptable_lp_safety text[] not null default array['LOCKED','BURNED']::text[],
  max_developer_holding_percent numeric,
  reject_confirmed_developer_sell boolean not null default true,
  require_sustained_confirmation boolean not null default true,
  require_dex_paid boolean not null default false,
  minimum_boost numeric,
  require_volume_acceleration boolean not null default false,
  max_slippage_bps integer not null default 300 check (max_slippage_bps between 0 and 10000),
  max_simultaneous_positions integer not null default 1 check (max_simultaneous_positions > 0),
  cooldown_seconds integer not null default 300 check (cooldown_seconds >= 0),
  maximum_daily_paper_loss_usd numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.user_paper_sniper_configs is
  'Non-executing PAPER strategy preferences. This table contains no signing material and is not connected to any trade executor.';
