-- REVIEW ONLY, NEVER APPLIED AUTOMATICALLY.
-- One-shot BUY submission claim for independently audited isolated signer.
-- Must run AFTER echo-live-buy-intents.sql,
-- echo-pilot-atomic-two-slot.sql, echo-pilot-all-in-atomic.sql.
-- Does NOT sign, store secrets or broadcast a transaction.
--
-- Rule: the signer must persist the exact signature and signed message hashes
-- BEFORE a single broadcast attempt. Unknown stays locked on RPC timeouts,
-- process crashes and restarts. No automatic retry or fresh tx construction.
begin;
alter table public.echo_live_buy_intents
 add column if not exists approved_message_sha256 text,
 add column if not exists signed_transaction_fingerprint_sha256 text,
 add column if not exists submission_claimed_at timestamptz;
alter table public.echo_live_buy_intents
 add constraint echo_pilot_approved_message_sha256_valid check(
 approved_message_sha256 is null or approved_message_sha256 ~ '^[0-9a-f]{64}$');
alter table public.echo_live_buy_intents
 add constraint echo_pilot_signed_fingerprint_valid check(
 signed_transaction_fingerprint_sha256 is null or
 signed_transaction_fingerprint_sha256 ~ '^[0-9a-f]{64}$');

-- The same on-chain signature must never be bound to two separate mints.
create unique index if not exists echo_pilot_unique_signed_signature
 on public.echo_live_buy_intents(execution_wallet,transaction_signature)
 where transaction_signature is not null;

create or replace function public.echo_pilot_claim_submission_once(
 p_execution_wallet text,p_mint text,p_signature text,
 p_approved_message_sha256 text,p_signed_fingerprint_sha256 text,
 p_last_valid_block_height bigint)
returns text language plpgsql security invoker set search_path=''
as $$
declare
 v_row public.echo_live_buy_intents%rowtype;
begin
 if p_execution_wallet is distinct from
     '8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ'
    or p_mint is null or p_mint !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
    or p_signature is null or
       p_signature !~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'
    or p_approved_message_sha256 is null or
       p_approved_message_sha256 !~ '^[0-9a-f]{64}$'
    or p_signed_fingerprint_sha256 is null or
       p_signed_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
    or p_last_valid_block_height is null or p_last_valid_block_height<=0
 then return 'INVALID_CLAIM'; end if;

 -- Same wallet-level lock as capital reservations, including replicas.
 perform pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended(p_execution_wallet,17391));
 select * into v_row from public.echo_live_buy_intents
  where execution_wallet=p_execution_wallet and mint=p_mint for update;
 if not found then return 'NO_RESERVATION'; end if;
 if v_row.state <> 'reserved' or v_row.transaction_signature is not null
   or v_row.position_closed_at is not null
   or v_row.submission_claimed_at is not null
 then return 'ALREADY_CLAIMED_OR_NOT_RESERVED'; end if;
 if v_row.pilot_all_in_reserved_cents is null
    or v_row.pilot_all_in_reserved_cents<=0
    or v_row.pilot_all_in_reserved_cents>1000
 then return 'ALL_IN_CAPITAL_NOT_RESERVED'; end if;
 -- Only a reviewed isolated signer can attest that this exact signature
 -- matches the correct unsigned transaction, economics and simulation.
 -- PostgreSQL cannot inspect the Solana Ed25519 message itself.
 update public.echo_live_buy_intents
  set state='unknown',
   transaction_signature=p_signature,
   approved_message_sha256=p_approved_message_sha256,
   signed_transaction_fingerprint_sha256=p_signed_fingerprint_sha256,
   last_valid_block_height=p_last_valid_block_height,
   submission_claimed_at=pg_catalog.now(),
   updated_at=pg_catalog.now()
  where execution_wallet=p_execution_wallet and mint=p_mint;
 return 'CLAIMED';
end;
$$;
revoke all on function public.echo_pilot_claim_submission_once(
 text,text,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.echo_pilot_claim_submission_once(
 text,text,text,text,text,bigint) to service_role;
commit;
