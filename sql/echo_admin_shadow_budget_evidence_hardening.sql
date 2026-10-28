-- Shadow budget evidence hardening: no automatic daily reset or trade execution.
-- Apply AFTER base budget migration, BEFORE atomic reservation migration.
BEGIN;
ALTER TABLE echo_admin_shadow_wallet_budget
 ADD COLUMN IF NOT EXISTS daily_window_start timestamptz,
 ADD COLUMN IF NOT EXISTS daily_loss_verified boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS daily_window_verified boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS caller_evidence_verified boolean NOT NULL DEFAULT false;
-- Conservative default: all three new verification flags are false.
-- Do not set them from untrusted Telegram requests or price estimates.
COMMIT;
