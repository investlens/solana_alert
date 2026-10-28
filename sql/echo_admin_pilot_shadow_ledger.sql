-- AlphaOS Echo admin pilot: PREPARATION ONLY.
-- Apply to an isolated, access-restricted database only after review.
-- No live executor or signer is connected to these tables.
BEGIN;
CREATE TABLE IF NOT EXISTS echo_admin_buy_intents (
  execution_wallet text NOT NULL CHECK (length(execution_wallet) BETWEEN 32 AND 44),
  mint text NOT NULL CHECK (length(mint) BETWEEN 32 AND 44),
  caller_wallet text NOT NULL,
  source_signature text NOT NULL,
  amount_lamports bigint NOT NULL CHECK (amount_lamports > 0 AND amount_lamports <= 100000000),
  state text NOT NULL DEFAULT 'reserved' CHECK (
    state IN ('reserved','signed','submitted','confirmed','failed_preflight','unknown','expired_unresolved')
  ),
  signed_transaction_ciphertext bytea,
  transaction_signature text,
  last_valid_block_height bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (execution_wallet, mint),
  CONSTRAINT signed_requires_signature CHECK (
    state NOT IN ('signed','submitted','confirmed') OR
    (transaction_signature IS NOT NULL AND signed_transaction_ciphertext IS NOT NULL)
  )
);
CREATE TABLE IF NOT EXISTS echo_admin_execution_controls (
  execution_wallet text PRIMARY KEY,
  emergency_stop boolean NOT NULL DEFAULT true,
  live_enabled boolean NOT NULL DEFAULT false CHECK (live_enabled = false),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Do not allow clients to query or mutate pilot custody records directly.
REVOKE ALL ON echo_admin_buy_intents FROM PUBLIC;
REVOKE ALL ON echo_admin_execution_controls FROM PUBLIC;
-- Reservation must be executed inside a SERIALIZABLE DB transaction that also
-- locks the wallet budget row and verifies current position and spend totals.
-- ON CONFLICT DO NOTHING means a mint is never automatically re-purchased.
CREATE OR REPLACE FUNCTION echo_admin_shadow_reserve(
  p_wallet text, p_mint text, p_caller text, p_signature text, p_amount bigint
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE inserted_count integer;
BEGIN
  -- Guard against accidentally calling this as a production trading path.
  -- This routine only stores shadow intent records; it cannot authorize signing.
  IF current_setting('echo.shadow_reservations_enabled', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Echo shadow reservation feature disabled';
  END IF;
  INSERT INTO echo_admin_buy_intents
    (execution_wallet,mint,caller_wallet,source_signature,amount_lamports)
  VALUES (p_wallet,p_mint,p_caller,p_signature,p_amount)
  ON CONFLICT (execution_wallet,mint) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count = 1;
END $$;
REVOKE ALL ON FUNCTION echo_admin_shadow_reserve(text,text,text,text,bigint) FROM PUBLIC;
COMMIT;
