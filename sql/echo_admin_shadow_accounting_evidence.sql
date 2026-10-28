-- Echo shadow accounting: record verified debit/fee snapshots without releasing
-- reserved funds or permitting a second BUY. Unapplied, review-only migration.
BEGIN;
CREATE TABLE IF NOT EXISTS echo_admin_shadow_accounting_evidence (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 execution_wallet text NOT NULL,
 mint text NOT NULL,
 transaction_signature text NOT NULL,
 pre_balance_lamports bigint NOT NULL CHECK(pre_balance_lamports>=0),
 post_balance_lamports bigint NOT NULL CHECK(post_balance_lamports>=0),
 verified_fee_lamports bigint NOT NULL CHECK(verified_fee_lamports>=0),
 observed_debit_lamports bigint GENERATED ALWAYS AS
   (pre_balance_lamports-post_balance_lamports) STORED,
 finalized_success boolean NOT NULL DEFAULT false,
 trusted_rpc boolean NOT NULL DEFAULT false,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(execution_wallet,mint) REFERENCES echo_admin_buy_intents(execution_wallet,mint),
 CONSTRAINT echo_accounting_valid_debit CHECK(pre_balance_lamports>=post_balance_lamports),
 CONSTRAINT echo_accounting_fee_bounded CHECK(
  verified_fee_lamports<=pre_balance_lamports-post_balance_lamports
 ),
 CONSTRAINT echo_accounting_verified CHECK(finalized_success AND trusted_rpc),
 UNIQUE(execution_wallet,mint,transaction_signature)
);
REVOKE ALL ON echo_admin_shadow_accounting_evidence FROM PUBLIC;
-- This evidence table intentionally does NOT update budget, release reserve,
-- reset daily limits, or mark a transaction safe to retry.
COMMIT;
