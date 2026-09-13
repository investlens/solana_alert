-- Emergency AlphaOS positive-alert security boundary.
-- PONS launches keep their existing security path. CUSTOM Robinhood and Solana
-- positive alerts require explicit verified LOCKED/BURNED liquidity evidence.

create or replace function public.alphaos_positive_liquidity_allowed(
  p_chain text,
  p_asset_id text,
  p_raw jsonb
)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  chain_name text := lower(coalesce(p_chain, ''));
  launch_is_pons boolean := false;
  lp_status text;
  lp_verified boolean := false;
begin
  if chain_name = 'robinhood' then
    select exists (
      select 1 from public.pons_launches p
      where p.chain = 'robinhood'
        and lower(p.token_address) = lower(coalesce(p_asset_id, ''))
    ) into launch_is_pons;
    if launch_is_pons then
      return true;
    end if;
  elsif chain_name <> 'solana' then
    return true;
  end if;

  lp_status := upper(coalesce(
    p_raw ->> 'liquiditySafetyStatus',
    p_raw ->> 'lpStatus',
    p_raw ->> 'lpLiquidityStatus',
    p_raw #>> '{liquiditySafety,status}',
    p_raw #>> '{lpSecurity,status}',
    p_raw #>> '{liquiditySecurity,status}',
    'UNKNOWN'
  ));
  lp_verified := coalesce((p_raw ->> 'liquiditySafetyVerified')::boolean, false)
    or coalesce((p_raw ->> 'lpStatusVerified')::boolean, false)
    or coalesce((p_raw ->> 'lpVerified')::boolean, false)
    or coalesce((p_raw #>> '{liquiditySafety,verified}')::boolean, false)
    or coalesce((p_raw #>> '{lpSecurity,verified}')::boolean, false)
    or coalesce((p_raw #>> '{liquiditySecurity,verified}')::boolean, false);

  return lp_verified and lp_status in ('LOCKED', 'BURNED');
exception when others then
  -- Security evidence parsing/lookup failures must fail closed.
  return false;
end;
$$;

create or replace function public.reserve_opportunity_delivery(
  p_opportunity_id bigint,
  p_telegram_id text,
  p_strategy_key text,
  p_chain text,
  p_recommended_action text,
  p_tier_at_delivery text,
  p_delivery_channel text,
  p_delivery_identity text,
  p_lease_token text,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  claimed_id bigint;
  opportunity_row public.opportunities%rowtype;
begin
  if upper(coalesce(p_recommended_action, '')) in ('BUY', 'CHECK_ENTRY')
     and lower(coalesce(p_chain, '')) in ('robinhood', 'solana') then
    select * into opportunity_row from public.opportunities where id = p_opportunity_id;
    if not found or not public.alphaos_positive_liquidity_allowed(
      p_chain, opportunity_row.asset_id, opportunity_row.raw_data
    ) then
      return false;
    end if;
  end if;

  insert into public.opportunity_deliveries (
    opportunity_id, telegram_id, strategy_key, chain, recommended_action,
    tier_at_delivery, delivery_channel, delivery_identity, metadata
  ) values (
    p_opportunity_id, p_telegram_id, p_strategy_key, p_chain,
    p_recommended_action, p_tier_at_delivery, p_delivery_channel,
    p_delivery_identity,
    jsonb_build_object('state', 'RESERVED', 'reserved_at', now(), 'lease_token', p_lease_token)
  )
  on conflict (opportunity_id, telegram_id, delivery_channel, delivery_identity) do nothing
  returning id into claimed_id;
  if claimed_id is not null then return true; end if;

  update public.opportunity_deliveries
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'state', 'RESERVED', 'reserved_at', now(), 'lease_token', p_lease_token, 'reclaimed', true
      ), created_at = now()
  where opportunity_id = p_opportunity_id
    and telegram_id = p_telegram_id
    and delivery_channel = p_delivery_channel
    and delivery_identity = p_delivery_identity
    and metadata ->> 'state' = 'RESERVED'
    and coalesce(nullif(metadata ->> 'reserved_at', '')::timestamptz, created_at)
      < now() - make_interval(secs => greatest(p_lease_seconds, 30))
  returning id into claimed_id;
  return claimed_id is not null;
end;
$$;

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

  if positive_event and lower(coalesce(alert_row.chain, '')) in ('robinhood', 'solana')
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

revoke all on function public.alphaos_positive_liquidity_allowed(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.alphaos_positive_liquidity_allowed(text, text, jsonb) to service_role;
