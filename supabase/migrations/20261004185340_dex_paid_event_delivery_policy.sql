-- Preserve lease/dedup semantics; remove the extra Robinchain DEX payment liquidity threshold.
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
declare
  claimed_id bigint;
  alert_row public.alpha_alert_events%rowtype;
  positive_event boolean;
begin
  select * into alert_row from public.alpha_alert_events where id = p_alert_event_id;
  if not found then return false; end if;

  positive_event := upper(coalesce(alert_row.alert_type, '')) in (
      'BOOST','DEX_PAID','VOLUME_SURGE','REIGNITION','TREND_REVERSAL','RUNNER','BREAKOUT',
      'PONS_PROVEN_DEV_LAUNCH','PROVEN_DEV_LAUNCH'
    ) or upper(coalesce(alert_row.lifecycle_action, '')) in ('BUY','CHECK_ENTRY');

  -- DEX Paid uses the runtime honeypot-only event gate, not trade-entry liquidity rules.
  if positive_event
     and not (upper(coalesce(alert_row.alert_type,'')) = 'DEX_PAID' and lower(coalesce(alert_row.chain,'')) = 'robinhood')
     and lower(coalesce(alert_row.chain, '')) in ('robinhood', 'solana')
     and not public.alphaos_positive_liquidity_allowed(
       alert_row.chain, alert_row.asset_id, alert_row.raw_snapshot
     ) then
    return false;
  end if;

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


revoke all on function public.reserve_alpha_semantic_delivery(bigint,text,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.reserve_alpha_semantic_delivery(bigint,text,text,text,text,integer) to service_role;
