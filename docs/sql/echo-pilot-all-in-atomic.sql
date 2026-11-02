-- REVIEW ONLY — NOT APPLIED TO PRODUCTION.
-- Run AFTER echo-live-buy-intents.sql and echo-pilot-atomic-two-slot.sql.
-- Replacement pilot admission for future LIVE executor. Do not call the old
-- echo_pilot_reserve_atomic path for spending: that path has no all-in cap.
-- This is a conservative lifetime gross commitment cap, not rolling P/L.
-- Amount/cost/balance proofs must be independently verified by the privileged
-- coordinator. SQL cannot verify prices or blockchain ownership by itself.
begin;
create table if not exists public.echo_pilot_capital_ledger (
 execution_wallet text primary key,
 committed_cents bigint not null default 0 check(committed_cents between 0 and 3000),
 last_verified_spendable_cents bigint not null default 0 check(last_verified_spendable_cents >= 0),
 last_balance_verified_at timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.echo_pilot_capital_ledger enable row level security;
revoke all on public.echo_pilot_capital_ledger from public,anon,authenticated;

alter table public.echo_live_buy_intents
 add column if not exists pilot_all_in_reserved_cents bigint
 check(pilot_all_in_reserved_cents is null or
       (pilot_all_in_reserved_cents > 0 and pilot_all_in_reserved_cents <= 1000));

-- The wallet balance snapshot is not an oracle: only the privileged worker can
-- attest that this snapshot came from trusted chain / FX reads. Insufficient
-- proof MUST be passed as NULL and will reject; no synthetic wallet balance.
create or replace function public.echo_pilot_reserve_all_in_atomic(
 p_execution_wallet text,p_mint text,p_caller_wallet text,
 p_source_signature text,p_amount_lamports bigint,
 p_principal_cents bigint,p_buy_cost_ceiling_cents bigint,
 p_exit_reserve_cents bigint,p_verified_spendable_wallet_cents bigint,
 p_balance_verified_at timestamptz)
returns text language plpgsql security invoker set search_path=''
as $$
declare
 v_count bigint;
 v_today bigint;
 v_committed bigint;
 v_reserved bigint;
 v_all_in bigint;
 v_expected text := '8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
begin
 if p_execution_wallet is distinct from v_expected
    or p_mint is null or p_mint !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
    or p_source_signature is null or p_source_signature !~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'
    or p_caller_wallet is null or p_caller_wallet not in (
      '5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',
      'Be24Gbf5KisDk1LcWWZsBn8dvB816By7YzYF5zWZnRR6')
    or p_amount_lamports is null or p_amount_lamports<=0
    or p_amount_lamports>100000000
    or p_principal_cents is null or p_principal_cents<=0
    or p_buy_cost_ceiling_cents is null or p_buy_cost_ceiling_cents<=0
    or p_exit_reserve_cents is null or p_exit_reserve_cents<=0
    or p_verified_spendable_wallet_cents is null
    or p_verified_spendable_wallet_cents<0
    or p_balance_verified_at is null or
       p_balance_verified_at>pg_catalog.now() or
       p_balance_verified_at<pg_catalog.now()-interval '3 seconds'
 then return 'INVALID_OR_STALE_ATTESTATION'; end if;
 v_all_in:=p_principal_cents+p_buy_cost_ceiling_cents;
 if v_all_in>1000 then return 'ALL_IN_ENTRY_CAP'; end if;
 -- Every replica serializes on the execution wallet, before any reads.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_execution_wallet,17391));
 -- Additional row-level lock persists against sibling SQL mutations.
 insert into public.echo_pilot_capital_ledger(execution_wallet)
 values(p_execution_wallet) on conflict(execution_wallet) do nothing;
 select committed_cents into v_committed from public.echo_pilot_capital_ledger
  where execution_wallet=p_execution_wallet for update;
 if v_committed+v_all_in>3000 then return 'PILOT_LIFETIME_CAP'; end if;
 if exists(select 1 from public.echo_live_buy_intents
   where execution_wallet=p_execution_wallet and mint=p_mint)
 then return 'DUPLICATE_TOKEN'; end if;
 select count(*),coalesce(sum(coalesce(pilot_all_in_reserved_cents,1000)),0)
 into v_count,v_reserved from public.echo_live_buy_intents
 where execution_wallet=p_execution_wallet
   and position_closed_at is null and state<>'failed_preflight';
 if v_count>=2 then return 'TWO_SLOTS_FULL'; end if;
 -- Existing historical slots with unknown total are conservatively counted
 -- as fully $10 each; no unpriced pending order escapes balance accounting.
 if p_verified_spendable_wallet_cents <
     v_reserved+v_all_in+p_exit_reserve_cents then return 'BALANCE_AND_EXIT_RESERVE'; end if;
 select count(*) into v_today from public.echo_live_buy_intents
 where execution_wallet=p_execution_wallet and created_at>=
   pg_catalog.date_trunc('day',pg_catalog.now() at time zone 'UTC') at time zone 'UTC';
 if v_today>=3 then return 'DAILY_LIMIT'; end if;
 insert into public.echo_live_buy_intents
 (execution_wallet,mint,caller_wallet,source_signature,amount_lamports,state,
  principal_usd,pilot_all_in_reserved_cents)
 values(p_execution_wallet,p_mint,p_caller_wallet,p_source_signature,
  p_amount_lamports,'reserved',10,v_all_in);
 update public.echo_pilot_capital_ledger set
 committed_cents=committed_cents+v_all_in,
 last_verified_spendable_cents=p_verified_spendable_wallet_cents,
 last_balance_verified_at=p_balance_verified_at,
 updated_at=pg_catalog.now()
 where execution_wallet=p_execution_wallet;
 return 'RESERVED';
exception
 when unique_violation then return 'DUPLICATE_TOKEN';
 when numeric_value_out_of_range then return 'INVALID_AMOUNT';
end;
$$;
revoke all on function public.echo_pilot_reserve_all_in_atomic(
 text,text,text,text,bigint,bigint,bigint,bigint,bigint,timestamptz)
 from public,anon,authenticated;
grant execute on function public.echo_pilot_reserve_all_in_atomic(
 text,text,text,text,bigint,bigint,bigint,bigint,bigint,timestamptz)
 to service_role;
commit;
