-- AlphaOS release-hardening compatibility and crash-recovery layer.
-- Forward-only: preserves all existing delivery and watchlist rows.

-- Pre-Phase-1 application versions omit delivery_identity. The sentinel default
-- is replaced by the trigger with the same deterministic v1 identity produced
-- by current application code. Explicit identities from new code are untouched.
alter table public.opportunity_deliveries
  alter column delivery_identity set default 'legacy:auto';

create or replace function public.alphaos_fill_legacy_delivery_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.delivery_identity is null or new.delivery_identity = 'legacy:auto' then
    new.delivery_identity := concat(
      'v1:',
      upper(coalesce(new.recommended_action, 'UNKNOWN')),
      ':NEW'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists alphaos_fill_legacy_delivery_identity
  on public.opportunity_deliveries;

create trigger alphaos_fill_legacy_delivery_identity
before insert on public.opportunity_deliveries
for each row execute function public.alphaos_fill_legacy_delivery_identity();

-- A reservation lease is stored in metadata so no additional table columns are
-- needed. INSERT handles the first claimant. The conditional UPDATE is one
-- atomic compare-and-swap: after one worker refreshes reserved_at, competitors
-- can no longer satisfy the stale predicate.
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
begin
  insert into public.opportunity_deliveries (
    opportunity_id, telegram_id, strategy_key, chain, recommended_action,
    tier_at_delivery, delivery_channel, delivery_identity, metadata
  ) values (
    p_opportunity_id, p_telegram_id, p_strategy_key, p_chain,
    p_recommended_action, p_tier_at_delivery, p_delivery_channel,
    p_delivery_identity,
    jsonb_build_object(
      'state', 'RESERVED',
      'reserved_at', now(),
      'lease_token', p_lease_token
    )
  )
  on conflict (opportunity_id, telegram_id, delivery_channel, delivery_identity)
  do nothing
  returning id into claimed_id;

  if claimed_id is not null then
    return true;
  end if;

  update public.opportunity_deliveries
  set
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'state', 'RESERVED',
      'reserved_at', now(),
      'lease_token', p_lease_token,
      'reclaimed', true
    ),
    created_at = now()
  where opportunity_id = p_opportunity_id
    and telegram_id = p_telegram_id
    and delivery_channel = p_delivery_channel
    and delivery_identity = p_delivery_identity
    and metadata ->> 'state' = 'RESERVED'
    and coalesce(
      nullif(metadata ->> 'reserved_at', '')::timestamptz,
      created_at
    ) < now() - make_interval(secs => greatest(p_lease_seconds, 30))
  returning id into claimed_id;

  return claimed_id is not null;
end;
$$;

create or replace function public.reserve_wallet_activity_delivery(
  p_telegram_id text,
  p_wallet_address text,
  p_transaction_signature text,
  p_activity_type text,
  p_token_address text,
  p_lease_token text,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  claimed_id bigint;
begin
  insert into public.wallet_activity_deliveries (
    telegram_id, wallet_address, transaction_signature, activity_type,
    token_address, metadata
  ) values (
    p_telegram_id, p_wallet_address, p_transaction_signature,
    p_activity_type, p_token_address,
    jsonb_build_object(
      'state', 'RESERVED',
      'reserved_at', now(),
      'lease_token', p_lease_token
    )
  )
  on conflict (telegram_id, wallet_address, transaction_signature)
  do nothing
  returning id into claimed_id;

  if claimed_id is not null then
    return true;
  end if;

  update public.wallet_activity_deliveries
  set
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'state', 'RESERVED',
      'reserved_at', now(),
      'lease_token', p_lease_token,
      'reclaimed', true
    ),
    created_at = now()
  where telegram_id = p_telegram_id
    and wallet_address = p_wallet_address
    and transaction_signature = p_transaction_signature
    and metadata ->> 'state' = 'RESERVED'
    and coalesce(
      nullif(metadata ->> 'reserved_at', '')::timestamptz,
      created_at
    ) < now() - make_interval(secs => greatest(p_lease_seconds, 30))
  returning id into claimed_id;

  return claimed_id is not null;
end;
$$;

comment on function public.reserve_opportunity_delivery(
  bigint, text, text, text, text, text, text, text, text, integer
) is
  'Atomically creates or reclaims a stale AlphaOS opportunity delivery lease.';

comment on function public.reserve_wallet_activity_delivery(
  text, text, text, text, text, text, integer
) is
  'Atomically creates or reclaims a stale AlphaOS wallet delivery lease.';

revoke all on function public.reserve_opportunity_delivery(
  bigint, text, text, text, text, text, text, text, text, integer
) from public, anon, authenticated;

revoke all on function public.reserve_wallet_activity_delivery(
  text, text, text, text, text, text, integer
) from public, anon, authenticated;

grant execute on function public.reserve_opportunity_delivery(
  bigint, text, text, text, text, text, text, text, text, integer
) to service_role;

grant execute on function public.reserve_wallet_activity_delivery(
  text, text, text, text, text, text, integer
) to service_role;
