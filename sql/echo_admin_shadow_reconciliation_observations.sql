-- Append-only read-only RPC reconciliation observations for the Echo shadow pilot.
-- Unapplied migration. Store observations separately from trade state: an RPC
-- observation alone must never authorize balance release or a retry.
BEGIN;
CREATE TABLE IF NOT EXISTS echo_admin_shadow_reconciliation_observations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 execution_wallet text NOT NULL,
 mint text NOT NULL,
 transaction_signature text,
 observed_at timestamptz NOT NULL DEFAULT now(),
 rpc_trusted boolean NOT NULL DEFAULT false,
 history_caught_up boolean NOT NULL DEFAULT false,
 finalized_success boolean NOT NULL DEFAULT false,
 finalized_failure boolean NOT NULL DEFAULT false,
 token_increase_verified boolean NOT NULL DEFAULT false,
 proposed_state text NOT NULL CHECK (
  proposed_state IN ('reserved','signed','submitted','confirmed','failed_preflight','unknown','expired_unresolved')
 ),
 evidence_reason text NOT NULL CHECK(length(evidence_reason) BETWEEN 1 AND 128),
 CONSTRAINT echo_reconciliation_intent_fk FOREIGN KEY (execution_wallet,mint)
   REFERENCES echo_admin_buy_intents(execution_wallet,mint),
 CONSTRAINT echo_reconciliation_no_conflict CHECK(NOT (finalized_success AND finalized_failure)),
 CONSTRAINT echo_reconciliation_confirmed_requires_evidence CHECK(
  proposed_state <> 'confirmed' OR
  (rpc_trusted AND history_caught_up AND finalized_success AND token_increase_verified)
 )
);
CREATE INDEX IF NOT EXISTS echo_admin_shadow_reconciliation_lookup
 ON echo_admin_shadow_reconciliation_observations(execution_wallet,mint,observed_at DESC);
REVOKE ALL ON echo_admin_shadow_reconciliation_observations FROM PUBLIC;
-- No automatic UPDATE of intent.state or budget balances in this migration.
-- An independent evidence verification and settlement routine is required.
COMMIT;
