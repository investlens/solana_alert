-- Echo admin pilot: offline schema hardening proposal ONLY.
-- Apply only after database owner, privilege, and transaction design review.
-- Not part of live execution. Defaults keep execution disabled.
BEGIN;
CREATE TABLE IF NOT EXISTS echo_admin_shadow_wallet_budget (
 execution_wallet text PRIMARY KEY CHECK(length(execution_wallet) BETWEEN 32 AND 44),
 observed_balance_lamports bigint NOT NULL DEFAULT 0 CHECK(observed_balance_lamports>=0),
 reserved_lamports bigint NOT NULL DEFAULT 0 CHECK(reserved_lamports>=0),
 min_reserve_lamports bigint NOT NULL DEFAULT 0 CHECK(min_reserve_lamports>=0),
 daily_spent_lamports bigint NOT NULL DEFAULT 0 CHECK(daily_spent_lamports>=0),
 daily_gross_cap_lamports bigint NOT NULL DEFAULT 0 CHECK(daily_gross_cap_lamports>=0),
 daily_loss_lamports bigint NOT NULL DEFAULT 0 CHECK(daily_loss_lamports>=0),
 daily_loss_limit_lamports bigint NOT NULL DEFAULT 0 CHECK(daily_loss_limit_lamports>=0),
 open_positions integer NOT NULL DEFAULT 0 CHECK(open_positions>=0),
 pending_positions integer NOT NULL DEFAULT 0 CHECK(pending_positions>=0),
 reconciliation_fresh boolean NOT NULL DEFAULT false,
 rpc_healthy boolean NOT NULL DEFAULT false,
 observed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON echo_admin_shadow_wallet_budget FROM PUBLIC;
-- A separate future serializable reservation routine MUST lock this wallet row
-- and the execution controls row, revalidate all limits and STOP state,
-- atomically reserve amount+fee, then insert the unique wallet/mint intent.
-- No such routine is exposed here because live signing is forbidden.
-- Never accept budget figures from Telegram or an untrusted API request.
COMMIT;
