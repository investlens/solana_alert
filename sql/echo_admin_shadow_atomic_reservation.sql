-- Echo shadow ONLY: atomic reservation prototype. Never authorizes signing.
-- Depends on echo_admin_pilot_shadow_ledger.sql, echo_admin_shadow_wallet_budget.sql\n-- and echo_admin_shadow_budget_evidence_hardening.sql.
-- Requires explicit DBA privilege review before application to an isolated database.
BEGIN;
CREATE OR REPLACE FUNCTION echo_admin_shadow_reserve_atomic(
 p_wallet text, p_mint text, p_caller text, p_signature text,
 p_amount bigint, p_fee_cap bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE b echo_admin_shadow_wallet_budget%ROWTYPE;
        c echo_admin_execution_controls%ROWTYPE;
        inserted_count integer;
BEGIN
 IF current_setting('echo.shadow_reservations_enabled', true) IS DISTINCT FROM 'on' THEN
  RAISE EXCEPTION 'shadow reservations disabled';
 END IF;
 IF p_amount IS NULL OR p_amount<=0 OR p_amount>100000000 OR
    p_fee_cap IS NULL OR p_fee_cap<0 OR p_fee_cap>10000000 THEN
  RETURN false;
 END IF;
 -- The caller must use a SERIALIZABLE transaction; abort otherwise.
 IF current_setting('transaction_isolation') <> 'serializable' THEN
  RAISE EXCEPTION 'serializable transaction required';
 END IF;
 SELECT * INTO c FROM echo_admin_execution_controls
  WHERE execution_wallet=p_wallet FOR UPDATE;
 IF NOT FOUND OR c.emergency_stop IS DISTINCT FROM false OR c.live_enabled IS DISTINCT FROM false THEN
  RETURN false;
 END IF;
 SELECT * INTO b FROM echo_admin_shadow_wallet_budget
  WHERE execution_wallet=p_wallet FOR UPDATE;
 IF NOT FOUND OR NOT b.reconciliation_fresh OR NOT b.rpc_healthy OR
    b.observed_at IS NULL OR b.observed_at<now()-interval '60 seconds' OR b.observed_at>now()+interval '5 seconds' OR
    NOT b.daily_loss_verified OR NOT b.daily_window_verified OR NOT b.caller_evidence_verified OR
    b.daily_window_start IS NULL OR b.daily_window_start>now() OR
    b.daily_window_start<now()-interval '24 hours' OR
    b.open_positions+b.pending_positions>=2 OR
    b.daily_loss_limit_lamports<=0 OR b.daily_loss_limit_lamports>150000000 OR
    b.daily_loss_lamports>=b.daily_loss_limit_lamports OR
    b.daily_gross_cap_lamports<=0 OR
    b.daily_spent_lamports+p_amount+p_fee_cap>b.daily_gross_cap_lamports OR
    b.observed_balance_lamports-b.reserved_lamports-p_amount-p_fee_cap<b.min_reserve_lamports THEN
  RETURN false;
 END IF;
 -- Prevent duplicate reservation even after the position has been sold.
 INSERT INTO echo_admin_buy_intents(execution_wallet,mint,caller_wallet,source_signature,amount_lamports)
 VALUES(p_wallet,p_mint,p_caller,p_signature,p_amount)
 ON CONFLICT(execution_wallet,mint) DO NOTHING;
 GET DIAGNOSTICS inserted_count=ROW_COUNT;
 IF inserted_count<>1 THEN RETURN false; END IF;
 UPDATE echo_admin_shadow_wallet_budget SET
   reserved_lamports=reserved_lamports+p_amount+p_fee_cap,
   daily_spent_lamports=daily_spent_lamports+p_amount+p_fee_cap,
   pending_positions=pending_positions+1,
   updated_at=now()
 WHERE execution_wallet=p_wallet;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION echo_admin_shadow_reserve_atomic(text,text,text,text,bigint,bigint) FROM PUBLIC;
COMMIT;
-- IMPORTANT: this is a SHADOW reservation accounting prototype only.
-- No release, settlement, day rollover, retries, or live execution adapter.
-- Caller verification is NOT implemented in SQL; do not grant untrusted roles EXECUTE.
