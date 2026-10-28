-- Shadow-only restart/recovery queue: preserve ambiguous intents, never retry.
-- The claim lease is for OBSERVATION only, never a transaction send.
BEGIN;
CREATE TABLE IF NOT EXISTS echo_admin_shadow_recovery_queue (
 execution_wallet text NOT NULL,
 mint text NOT NULL,
 next_observation_at timestamptz NOT NULL DEFAULT now(),
 lease_owner text,
 lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 last_error text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(execution_wallet,mint),
 FOREIGN KEY(execution_wallet,mint) REFERENCES echo_admin_buy_intents(execution_wallet,mint),
 CONSTRAINT echo_recovery_lease_consistency CHECK(
  (lease_owner IS NULL AND lease_until IS NULL) OR
  (lease_owner IS NOT NULL AND lease_until IS NOT NULL)
 )
);
REVOKE ALL ON echo_admin_shadow_recovery_queue FROM PUBLIC;
CREATE INDEX IF NOT EXISTS echo_admin_shadow_recovery_due_idx
 ON echo_admin_shadow_recovery_queue(next_observation_at,lease_until);
CREATE OR REPLACE FUNCTION echo_admin_shadow_claim_observations(
 p_worker text,p_limit integer,p_lease_seconds integer
) RETURNS TABLE(execution_wallet text,mint text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF current_setting('echo.shadow_observer_enabled',true) IS DISTINCT FROM 'on' THEN
  RAISE EXCEPTION 'shadow observer disabled';
 END IF;
 IF p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 80 OR
    p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25 OR
    p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 120 THEN
  RAISE EXCEPTION 'invalid observation lease';
 END IF;
 RETURN QUERY
 WITH due AS (
  SELECT q.execution_wallet,q.mint FROM echo_admin_shadow_recovery_queue q
  JOIN echo_admin_buy_intents i USING(execution_wallet,mint)
  WHERE q.next_observation_at<=now()
    AND (q.lease_until IS NULL OR q.lease_until<now())
    AND i.state IN ('signed','submitted','unknown','expired_unresolved')
  ORDER BY q.next_observation_at,q.execution_wallet,q.mint
  FOR UPDATE OF q SKIP LOCKED LIMIT p_limit
 )
 UPDATE echo_admin_shadow_recovery_queue q
 SET lease_owner=p_worker,lease_until=now()+make_interval(secs=>p_lease_seconds),
     attempts=q.attempts+1,updated_at=now()
 FROM due WHERE q.execution_wallet=due.execution_wallet AND q.mint=due.mint
 RETURNING q.execution_wallet,q.mint;
END $$;
REVOKE ALL ON FUNCTION echo_admin_shadow_claim_observations(text,integer,integer) FROM PUBLIC;
COMMIT;
-- IMPORTANT: this only schedules read-only observations, not purchase retries.
