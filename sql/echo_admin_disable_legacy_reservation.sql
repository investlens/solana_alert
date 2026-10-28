-- Defense in depth: disable legacy reserve entry point, which did not
-- lock or charge the wallet budget. Apply after the base shadow ledger.
-- The atomic reservation remains the only supported shadow reservation path.
BEGIN;
CREATE OR REPLACE FUNCTION echo_admin_shadow_reserve(
 p_wallet text,p_mint text,p_caller text,p_signature text,p_amount bigint
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER
SET search_path=public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'legacy shadow reservation disabled; use reviewed atomic reservation';
END $$;
REVOKE ALL ON FUNCTION echo_admin_shadow_reserve(text,text,text,text,bigint) FROM PUBLIC;
COMMIT;
