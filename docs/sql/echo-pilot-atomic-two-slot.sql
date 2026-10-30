-- REVIEW ONLY: not applied. Echo $10/two-position atomic reservation.
-- Requires docs/sql/echo-live-buy-intents.sql first. Run only after production schema review.
-- The primary key persists across sales: same execution wallet can NEVER rebuy a mint.
begin;
alter table public.echo_live_buy_intents
  add column if not exists position_closed_at timestamptz,
  add column if not exists sell_signature text,
  add column if not exists principal_usd numeric(8,2) not null default 10;
alter table public.echo_live_buy_intents
  add constraint echo_pilot_principal_ten check (principal_usd = 10);
alter table public.echo_live_buy_intents
  add constraint echo_pilot_closed_requires_sell_proof check (
    position_closed_at is null or (state = 'confirmed' and sell_signature is not null)
  );
-- Existing state 'confirmed' means the BUY was confirmed, not a SELL.
-- Only a separate chain-proof reconciliation routine may set position_closed_at.
create or replace function public.echo_pilot_reserve_atomic(
 p_execution_wallet text, p_mint text, p_caller_wallet text,
 p_source_signature text, p_amount_lamports bigint)
returns text language plpgsql security invoker set search_path = ''
as $$
declare v_count bigint; v_today bigint; v_existing boolean;
begin
 if p_execution_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
    or p_mint !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
    or p_source_signature !~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'
    or p_caller_wallet not in (
      '5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',
      'Be24Gbf5KisDk1LcWWZsBn8dvB816By7YzYF5zWZnRR6')
    or p_amount_lamports is null or p_amount_lamports <= 0
    or p_amount_lamports > 100000000 then
   return 'INVALID_REQUEST';
 end if;
 -- Serializes all reservations for one execution wallet across replicas.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_execution_wallet, 17391));
 select exists(select 1 from public.echo_live_buy_intents
   where execution_wallet=p_execution_wallet and mint=p_mint)
   into v_existing;
 if v_existing then return 'DUPLICATE_TOKEN'; end if;
 -- Pending, unknown, and confirmed unsold buys ALL hold a slot.
 select count(*) into v_count from public.echo_live_buy_intents
  where execution_wallet=p_execution_wallet
    and position_closed_at is null and state <> 'failed_preflight';
 if v_count >= 2 then return 'TWO_SLOTS_FULL'; end if;
 select count(*) into v_today from public.echo_live_buy_intents
  where execution_wallet=p_execution_wallet and created_at >=
    pg_catalog.date_trunc('day',pg_catalog.now() at time zone 'UTC') at time zone 'UTC';
 if v_today >= 3 then return 'DAILY_LIMIT'; end if;
 insert into public.echo_live_buy_intents
 (execution_wallet,mint,caller_wallet,source_signature,amount_lamports,state,principal_usd)
 values(p_execution_wallet,p_mint,p_caller_wallet,p_source_signature,p_amount_lamports,'reserved',10);
 return 'RESERVED';
exception when unique_violation then return 'DUPLICATE_TOKEN';
end;
$$;
revoke all on function public.echo_pilot_reserve_atomic(text,text,text,text,bigint)
  from public, anon, authenticated;
grant execute on function public.echo_pilot_reserve_atomic(text,text,text,text,bigint)
  to service_role;
commit;
-- Fail closed on any RPC error. Never release slots for unknown submission.
-- Daily cap is UTC; max active cost is two $10 PRINCIPAL positions (excludes network fees).
-- Manual SELL settlement must require verified on-chain token debit and proceeds.
