-- AlphaOS immutable semantic alert ledger. Authoritative from deployment forward.
create table if not exists public.alpha_alert_events (
  id bigserial primary key,
  event_identity text not null unique,
  opportunity_id bigint references public.opportunities(id) on delete set null,
  asset_id text not null,
  chain text not null,
  strategy_key text,
  lifecycle_action text not null,
  lifecycle_state text not null,
  alert_type text not null,
  delivery_identity text,
  symbol text,
  token_name text,
  confidence numeric,
  risk_score numeric,
  risk_label text,
  reason text,
  current_roi numeric,
  roi_change numeric,
  price numeric,
  price_provenance text,
  market_cap numeric,
  fdv numeric,
  valuation_type text,
  valuation_provenance text,
  liquidity numeric,
  volume_5m numeric,
  market_index_state text,
  chart_available boolean not null default false,
  elapsed_seconds integer,
  dev_holding_percent numeric,
  dev_holding_evidence text,
  dev_holding_source text,
  burned_percent numeric,
  burn_evidence text,
  burn_source text,
  developer_transferred_percent numeric,
  boost_total numeric,
  boost_increment numeric,
  creator_evidence jsonb,
  risk_evidence jsonb,
  raw_snapshot jsonb not null,
  alerted_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint alpha_alert_events_action_check check
    (lifecycle_action in ('BUY', 'CHECK_ENTRY', 'EXIT', 'AVOID'))
);

create index if not exists alpha_alert_events_asset_time_idx
  on public.alpha_alert_events(chain, lower(asset_id), alerted_at desc);
create index if not exists alpha_alert_events_action_time_idx
  on public.alpha_alert_events(lifecycle_action, alerted_at desc);
create index if not exists alpha_alert_events_strategy_time_idx
  on public.alpha_alert_events(strategy_key, alerted_at desc);

create or replace function public.reject_alpha_alert_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'alpha_alert_events is append-only';
end;
$$;

drop trigger if exists alpha_alert_events_no_update on public.alpha_alert_events;
create trigger alpha_alert_events_no_update before update on public.alpha_alert_events
for each row execute function public.reject_alpha_alert_event_mutation();
drop trigger if exists alpha_alert_events_no_delete on public.alpha_alert_events;
create trigger alpha_alert_events_no_delete before delete on public.alpha_alert_events
for each row execute function public.reject_alpha_alert_event_mutation();

comment on table public.alpha_alert_events is
  'Append-only canonical AlphaOS lifecycle alerts with the normalized notification context frozen at alert time.';
