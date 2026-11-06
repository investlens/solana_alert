-- REVIEW ONLY. NOT APPLIED TO PRODUCTION.
-- Execution lot is the immutable verified source call, NOT wallet+mint.
-- Run AFTER echo-five-dollar-per-call-review-only.sql and independent backup.
-- A signed transaction can be broadcast AT MOST ONCE, with UNKNOWN locked.
begin;
create or replace function public.echo_claim_five_usd_submission_once(
 p_execution_wallet text,p_caller_wallet text,p_source_signature text,p_mint text,
 p_signed_transaction_signature text,p_approved_message_sha256 text,
 p_signed_fingerprint_sha256 text)
returns text language plpgsql security invoker set search_path=''
as $$
declare v_row public.echo_per_call_buy_intents%rowtype;
begin
 if p_execution_wallet is distinct from
   '8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ'
 or p_caller_wallet is null or p_caller_wallet not in(
  '5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',
  'Be24Gbf5KisDk1LcWWZsBn8dvB816By7YzYF5zWZnRR6')
 or p_source_signature is null or p_source_signature !~
  '^[1-9A-HJ-NP-Za-km-z]{64,88}$'
 or p_mint is null or p_mint !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
 or p_signed_transaction_signature is null or p_signed_transaction_signature !~
  '^[1-9A-HJ-NP-Za-km-z]{64,88}$'
 or p_approved_message_sha256 is null or p_approved_message_sha256 !~ '^[0-9a-f]{64}$'
 or p_signed_fingerprint_sha256 is null or p_signed_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
 then return 'INVALID_SUBMISSION_CLAIM';end if;
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(p_execution_wallet,17391));
 select * into v_row from public.echo_per_call_buy_intents
 where execution_wallet=p_execution_wallet and caller_wallet=p_caller_wallet
   and source_signature=p_source_signature and mint=p_mint for update;
 if not found then return 'NO_RESERVATION';end if;
 if v_row.state<>'reserved' or v_row.submission_claimed_at is not null
    or v_row.transaction_signature is not null or v_row.position_closed_at is not null
 then return 'ALREADY_CLAIMED_OR_UNRESOLVED';end if;
 if v_row.all_in_cents>500 or v_row.all_in_lamports<=0
 then return 'FIVE_DOLLAR_CAP_UNVERIFIED';end if;
 update public.echo_per_call_buy_intents set
 state='unknown',transaction_signature=p_signed_transaction_signature,
 approved_message_sha256=p_approved_message_sha256,
 signed_transaction_fingerprint_sha256=p_signed_fingerprint_sha256,
 submission_claimed_at=pg_catalog.now(),updated_at=pg_catalog.now()
 where execution_wallet=p_execution_wallet and caller_wallet=p_caller_wallet
   and source_signature=p_source_signature and mint=p_mint;
 return 'CLAIMED';
exception when unique_violation then return 'SIGNATURE_ALREADY_USED';
end;
$$;
revoke all on function public.echo_claim_five_usd_submission_once(
 text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.echo_claim_five_usd_submission_once(
 text,text,text,text,text,text,text) to service_role;
commit;
