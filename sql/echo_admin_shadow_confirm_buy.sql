-- Echo shadow-only confirmed BUY settlement.
-- This does not send trades, release reservations, or authorize retry.
-- Requires independently verified finalized success and token increase evidence.
BEGIN;
CREATE OR REPLACE FUNCTION echo_admin_shadow_confirm_buy(
 p_wallet text,p_mint text,p_observation_id bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE i echo_admin_buy_intents%ROWTYPE;
        b echo_admin_shadow_wallet_budget%ROWTYPE;
        e echo_admin_shadow_reconciliation_observations%ROWTYPE;
BEGIN
 IF current_setting('echo.shadow_settlement_enabled',true) IS DISTINCT FROM 'on' THEN
  RAISE EXCEPTION 'shadow settlement disabled';
 END IF;
 IF current_setting('transaction_isolation') <> 'serializable' THEN
  RAISE EXCEPTION 'serializable transaction required';
 END IF;
 -- Stable lock order: controls, budget, intent, evidence.
 PERFORM 1 FROM echo_admin_execution_controls
  WHERE execution_wallet=p_wallet FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO b FROM echo_admin_shadow_wallet_budget
  WHERE execution_wallet=p_wallet FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO i FROM echo_admin_buy_intents
  WHERE execution_wallet=p_wallet AND mint=p_mint FOR UPDATE;
 IF NOT FOUND OR i.state NOT IN ('submitted','unknown','expired_unresolved') THEN
  RETURN false;
 END IF;
 SELECT * INTO e FROM echo_admin_shadow_reconciliation_observations
  WHERE id=p_observation_id AND execution_wallet=p_wallet AND mint=p_mint
  FOR UPDATE;
 IF NOT FOUND OR e.proposed_state <> 'confirmed' OR
    e.transaction_signature IS DISTINCT FROM i.transaction_signature OR
    NOT e.rpc_trusted OR NOT e.history_caught_up OR
    NOT e.finalized_success OR NOT e.token_increase_verified OR e.finalized_failure THEN
  RETURN false;
 END IF;
 IF b.pending_positions<1 OR b.open_positions>=2 THEN RETURN false; END IF;
 UPDATE echo_admin_buy_intents SET state='confirmed',updated_at=now()
  WHERE execution_wallet=p_wallet AND mint=p_mint;
 UPDATE echo_admin_shadow_wallet_budget SET
  pending_positions=pending_positions-1,
  open_positions=open_positions+1,
  updated_at=now()
 WHERE execution_wallet=p_wallet;
 -- Reserved funds intentionally stay held until a separately verified
 -- accounting reconciliation settles actual debits and fees.
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION echo_admin_shadow_confirm_buy(text,text,bigint) FROM PUBLIC;
COMMIT;
