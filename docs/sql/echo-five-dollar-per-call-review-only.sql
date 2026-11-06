-- REVIEW ONLY. DO NOT RUN ON PRODUCTION UNTIL INDEPENDENT RECOVERY IS VERIFIED.
-- Separate table from legacy one-buy-per-mint ledger; keeps original alerts intact.
-- A *source transaction signature* is the durable idempotency boundary.
-- A new valid source signature may buy the same mint again; an identical source
-- signature must never trigger another purchase, even after manual full SELL.
-- No lifetime USD spend cap. Each BUY still has a strict $5 all-in ceiling.
begin;
create table if not exists public.echo_per_call_buy_intents (
 execution_wallet text not null,
 caller_wallet text not null,
 source_signature text not null,
 mint text not null,
 amount_lamports bigint not null check(amount_lamports>0),
 exact_fee_lamports bigint not null check(exact_fee_lamports>0),
 account_rent_lamports bigint not null check(account_rent_lamports>=0),
 cpi_extra_lamports bigint not null check(cpi_extra_lamports>=0),
 all_in_lamports bigint not null check(all_in_lamports>0),
 all_in_cents bigint not null check(all_in_cents>0 and all_in_cents<=500),
 sell_reserve_lamports bigint not null check(sell_reserve_lamports>0),
 state text not null default 'reserved'
   check(state in ('reserved','signed','unknown','submitted','confirmed','failed_preflight','expired_unresolved','closed')),
 transaction_signature text,
 approved_message_sha256 text,
 signed_transaction_fingerprint_sha256 text,
 submission_claimed_at timestamptz,
 position_closed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(execution_wallet,caller_wallet,source_signature,mint),
 check(execution_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
 check(caller_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
 check(source_signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
 check(mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
 check(approved_message_sha256 is null or approved_message_sha256 ~ '^[0-9a-f]{64}$'),
 check(signed_transaction_fingerprint_sha256 is null or signed_transaction_fingerprint_sha256 ~ '^[0-9a-f]{64}$')
);
alter table public.echo_per_call_buy_intents enable row level security;
revoke all on public.echo_per_call_buy_intents from public, anon, authenticated;
grant select,insert,update on public.echo_per_call_buy_intents to service_role;
create unique index if not exists echo_per_call_one_signed_transaction
 on public.echo_per_call_buy_intents(execution_wallet,transaction_signature)
 where transaction_signature is not null;
-- A single source chain transaction can generate multiple notification/classifier
-- paths; guard the signature alone for wallet, regardless of reported mint.
create unique index if not exists echo_per_call_one_source_transaction
 on public.echo_per_call_buy_intents(execution_wallet,source_signature);

create or replace function public.echo_reserve_five_usd_distinct_call(
 p_execution_wallet text,p_caller_wallet text,p_source_signature text,p_mint text,
 p_amount_lamports bigint,p_exact_fee_lamports bigint,
 p_account_rent_lamports bigint,p_extra_cpi_lamports bigint,
 p_exit_reserve_lamports bigint,p_sol_usd_cents bigint,
 p_spendable_wallet_lamports bigint,p_balance_verified_at timestamptz,
 p_market_cap_usd bigint,p_market_cap_verified_at timestamptz)
returns text language plpgsql security invoker set search_path=''
as $$
declare v_debit bigint; v_cents bigint; v_reserved bigint; v_exit_reserves bigint;
 v_active_lots bigint;
begin
 if p_execution_wallet is distinct from
     '8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ'
    or p_caller_wallet is null or p_caller_wallet not in (
      '5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',
      'Be24Gbf5KisDk1LcWWZsBn8dvB816By7YzYF5zWZnRR6')
    or p_source_signature is null or p_source_signature !~
      '^[1-9A-HJ-NP-Za-km-z]{64,88}$'
    or p_mint is null or p_mint !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
    or p_amount_lamports is null or p_amount_lamports<=0
    or p_exact_fee_lamports is null or p_exact_fee_lamports<=0
    or p_account_rent_lamports is null or p_account_rent_lamports<0
    or p_extra_cpi_lamports is null or p_extra_cpi_lamports<0
    or p_exit_reserve_lamports is null or p_exit_reserve_lamports<=0
    or p_sol_usd_cents is null or p_sol_usd_cents<=0 or p_sol_usd_cents>100000000
    or p_spendable_wallet_lamports is null or p_spendable_wallet_lamports<0
    or p_balance_verified_at is null or
       p_balance_verified_at>pg_catalog.now() or
       p_balance_verified_at<pg_catalog.now()-interval '3 seconds'
    or p_market_cap_usd is null or p_market_cap_usd<=0
    or p_market_cap_usd>500000
    or p_market_cap_verified_at is null
    or p_market_cap_verified_at>pg_catalog.now()
    or p_market_cap_verified_at<pg_catalog.now()-interval '2 seconds'
 then return 'INVALID_OR_STALE_ATTESTATION';end if;
 -- Validated trusted coordinator supplies exact message/inner CPI and balance
 -- attestations. SQL can enforce arithmetic and serialization, but CANNOT
 -- prove Solana transaction provenance or an RPC response's authenticity.
 v_debit:=p_amount_lamports+p_exact_fee_lamports+
          p_account_rent_lamports+p_extra_cpi_lamports;
 if v_debit<=0 or v_debit>1000000000000 then return 'INVALID_DEBIT';end if;
 v_cents:=(v_debit*p_sol_usd_cents+999999999)/1000000000;
 if v_cents>500 then return 'FIVE_DOLLAR_ALL_IN_CAP';end if;
 perform pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended(p_execution_wallet,17391));
 if exists(select 1 from public.echo_per_call_buy_intents
   where execution_wallet=p_execution_wallet and
   caller_wallet=p_caller_wallet and source_signature=p_source_signature)
 then return 'DUPLICATE_SOURCE_TRANSACTION';end if;
 -- Pending/UNKNOWN messages remain occupied until independently reconciled.
 -- Current on-chain balance already reflects confirmed debits, so don't
 -- subtract them a second time. Pending/UNKNOWN debits remain reserved.
 -- Every unclosed lot (including confirmed) retains a manual SELL reserve.
 select coalesce(sum(case when state in (
          'reserved','signed','unknown','submitted','expired_unresolved')
        then all_in_lamports else 0 end),0),
        coalesce(sum(case when state not in ('failed_preflight','closed')
          then sell_reserve_lamports else 0 end),0),
        count(*) filter (where state not in ('failed_preflight','closed'))
 into v_reserved,v_exit_reserves,v_active_lots from public.echo_per_call_buy_intents
 where execution_wallet=p_execution_wallet and position_closed_at is null;
 -- Atomic wallet-wide maximum of two live/pending lots. Advisory transaction
 -- lock serializes simultaneous independent calls before count and insert.
 if v_active_lots>=2 then return 'TWO_ACTIVE_OR_PENDING_LOTS_LIMIT';end if;
 -- The real existing legacy Echo table does NOT have position_closed_at.
 -- Until all legacy rows have been independently reconciled, fail closed if
 -- this wallet has any legacy intent; do not assume an old confirmed BUY sold.
 if exists(select 1 from public.echo_live_buy_intents
     where execution_wallet=p_execution_wallet)
 then return 'LEGACY_INTENTS_REQUIRE_RECONCILIATION';end if;
 -- Keep exact available-wallet solvency checks and every open position's
 -- independent manual-exit reserve. The next order has its own reserve.
 if p_spendable_wallet_lamports < 
    v_reserved+v_exit_reserves+v_debit+p_exit_reserve_lamports
 then return 'INSUFFICIENT_WALLET_BALANCE_AND_EXIT_RESERVE';end if;
 insert into public.echo_per_call_buy_intents(
   execution_wallet,caller_wallet,source_signature,mint,amount_lamports,
   exact_fee_lamports,account_rent_lamports,cpi_extra_lamports,
   all_in_lamports,all_in_cents,sell_reserve_lamports)
 values(p_execution_wallet,p_caller_wallet,p_source_signature,p_mint,p_amount_lamports,
   p_exact_fee_lamports,p_account_rent_lamports,p_extra_cpi_lamports,
   v_debit,v_cents,p_exit_reserve_lamports);
 return 'RESERVED';
exception when unique_violation then return 'DUPLICATE_SOURCE_TRANSACTION';
 when numeric_value_out_of_range then return 'INVALID_DEBIT';
end;
$$;
revoke all on function public.echo_reserve_five_usd_distinct_call(
 text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,bigint,timestamptz)
 from public, anon, authenticated;
grant execute on function public.echo_reserve_five_usd_distinct_call(
 text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,bigint,timestamptz)
 to service_role;
commit;
