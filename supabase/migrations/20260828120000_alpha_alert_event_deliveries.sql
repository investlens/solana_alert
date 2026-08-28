-- Per-user delivery ledger for user-facing semantic AlphaOS events.
-- Does not alter semantic events, opportunities, wallet monitoring, or execution state.

create table if not exists public.alpha_alert_event_deliveries (
  id bigserial primary key,
  alert_event_id bigint not null references public.alpha_alert_events(id) on delete restrict,
  telegram_id text not null,
  tier_at_delivery text not null check (tier_at_delivery in ('admin', 'paid', 'free')),
  delivery_channel text not null default 'telegram',
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (alert_event_id, telegram_id, delivery_channel)
);

create index if not exists alpha_alert_event_deliveries_event_idx
  on public.alpha_alert_event_deliveries(alert_event_id);
create index if not exists alpha_alert_event_deliveries_user_time_idx
  on public.alpha_alert_event_deliveries(telegram_id, delivered_at desc);

alter table public.alpha_alert_event_deliveries enable row level security;
revoke all on table public.alpha_alert_event_deliveries from public, anon, authenticated, service_role;
grant select, insert, update on table public.alpha_alert_event_deliveries to service_role;
grant usage, select on sequence public.alpha_alert_event_deliveries_id_seq to service_role;

create or replace function public.reserve_alpha_semantic_delivery(
  p_alert_event_id bigint,
  p_telegram_id text,
  p_tier_at_delivery text,
  p_delivery_channel text,
  p_lease_token text,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
set search_path = public
as $$
declare claimed_id bigint;
begin
  insert into public.alpha_alert_event_deliveries (
    alert_event_id, telegram_id, tier_at_delivery, delivery_channel, metadata
  ) values (
    p_alert_event_id, p_telegram_id, p_tier_at_delivery, p_delivery_channel,
    jsonb_build_object('state', 'RESERVED', 'reserved_at', now(), 'lease_token', p_lease_token)
  )
  on conflict (alert_event_id, telegram_id, delivery_channel) do nothing
  returning id into claimed_id;
  if claimed_id is not null then return true; end if;

  update public.alpha_alert_event_deliveries
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'state', 'RESERVED', 'reserved_at', now(), 'lease_token', p_lease_token, 'reclaimed', true
      ), created_at = now()
  where alert_event_id = p_alert_event_id
    and telegram_id = p_telegram_id
    and delivery_channel = p_delivery_channel
    and metadata ->> 'state' = 'RESERVED'
    and coalesce(nullif(metadata ->> 'reserved_at', '')::timestamptz, created_at)
      < now() - make_interval(secs => greatest(p_lease_seconds, 30))
  returning id into claimed_id;
  return claimed_id is not null;
end;
$$;

revoke all on function public.reserve_alpha_semantic_delivery(bigint, text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_alpha_semantic_delivery(bigint, text, text, text, text, integer)
  to service_role;

comment on table public.alpha_alert_event_deliveries is
  'Per-user reservation, deduplication, and delivery history for user-facing semantic AlphaOS alerts.';
