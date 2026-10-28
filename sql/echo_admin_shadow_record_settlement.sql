-- Shadow-only accounting settlement after independently verified BUY.
-- Requires serializable transaction and holds locks on controls/budget/intent.
-- No live signer, trade broadcast, reserve release or daily cap reset.
BEGIN;
CREATE OR REPLACE FUNCTION echo_admin_shadow_record_settlement(
 p_wallet text,p_mint text,p_accounting_id bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE i echo_admin_buy_intents%ROWTYPE;
        b echo_admin_shadow_wallet_budget%ROWTYPE;
        a echo_admin_shadow_accounting_evidence%ROWTYPE;
        inserted_count integer;
BEGIN
 IF current_setting('echo.shadow_accounting_enabled',true) IS DISTINCT FROM 'on' THEN
  RAISE EXCEPTION 'shadow accounting disabled';
 END IF;
 IF current_setting('transaction_isolation') <> 'serializable' THEN
  RAISE EXCEPTION 'serializable transaction required';
 END IF;
 PERFORM 1 FROM echo_admin_execution_controls WHERE execution_wallet=p_wallet FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO b FROM echo_admin_shadow_wallet_budget
  WHERE execution_wallet=p_wallet FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO i FROM echo_admin_buy_intents
  WHERE execution_wallet=p_wallet AND mint=p_mint FOR UPDATE;
 IF NOT FOUND OR i.state <> 'confirmed' THEN RETURN false; END IF;
 SELECT * INTO a FROM echo_admin_shadow_accounting_evidence
  WHERE id=p_accounting_id AND execution_wallet=p_wallet AND mint=p_mint FOR UPDATE;
 IF NOT FOUND OR a.transaction_signature IS DISTINCT FROM i.transaction_signature OR
    NOT a.finalized_success OR NOT a.trusted_rpc OR
    a.observed_debit_lamports<0 OR
    a.observed_debit_lamports>b.reserved_lamports OR
    a.observed_debit_lamports-a.verified_fee_lamports>i.amount_lamports THEN
  RETURN false;
 END IF;
 INSERT INTO echo_admin_shadow_accounting_settlements(
   execution_wallet,mint,accounting_evidence_id,settled_debit_lamports
 ) VALUES(p_wallet,p_mint,p_accounting_id,a.observed_debit_lamports)
 ON CONFLICT(execution_wallet,mint) DO NOTHING;
 GET DIAGNOSTICS inserted_count=ROW_COUNT;
 IF inserted_count<>1 THEN RETURN false; END IF;
 -- Hold any difference between reserved estimate and observed debit until
 -- a separately authorized balance-refresh and fee reconciliation process.
 -- Avoid double-counting daily spending: reservation already charged it.
 UPDATE echo_admin_shadow_wallet_budget SET updated_at=now()
 WHERE execution_wallet=p_wallet;
 RETURN true;
END $$;
CREATE TABLE IF NOT EXISTS echo_admin_shadow_accounting_settlements (
 execution_wallet text NOT NULL,
 mint text NOT NULL,
 accounting_evidence_id bigint NOT NULL UNIQUE
   REFERENCES echo_admin_shadow_accounting_evidence(id),
 settled_debit_lamports bigint NOT NULL CHECK(settled_debit_lamports>=0),
 settled_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(execution_wallet,mint),
 FOREIGN KEY(execution_wallet,mint) REFERENCES echo_admin_buy_intents(execution_wallet,mint)
);
REVOKE ALL ON echo_admin_shadow_accounting_settlements FROM PUBLIC;
REVOKE ALL ON FUNCTION echo_admin_shadow_record_settlement(text,text,bigint) FROM PUBLIC;
COMMIT;
