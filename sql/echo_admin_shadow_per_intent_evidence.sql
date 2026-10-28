-- Isolated Echo shadow database only. Apply before the atomic reservation function.
-- This table must only be populated by a separately reviewed, trusted decoder.
-- No decoder is currently authorized to set verified=true.
BEGIN;
CREATE TABLE IF NOT EXISTS echo_admin_verified_caller_buy_evidence(
 caller_wallet text NOT NULL CHECK (caller_wallet IN (
 '5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',
 'Be24Gbf5KisDk1LcWWZsBn8dvB816By7YzYF5zWZnRR6')),
 source_signature text NOT NULL,
 mint text NOT NULL,
 verified boolean NOT NULL DEFAULT false CHECK (verified=false),
 finalized boolean NOT NULL DEFAULT false,
 observed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (caller_wallet,source_signature,mint)
);
REVOKE ALL ON echo_admin_verified_caller_buy_evidence FROM PUBLIC;
COMMIT;
-- Fail-closed deliberately: CHECK(verified=false) means no reservations
-- can pass until trusted decoder, immutable evidence insertion and role
-- permissions have passed independent security review.
