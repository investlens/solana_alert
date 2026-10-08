CREATE OR REPLACE FUNCTION public.alphaos_trim_stale_agent_payloads()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE changed integer;
BEGIN
  -- Keep decision summaries, creators and every recorded outcome.
  -- Only discard obsolete raw inputs from unreviewed, outcome-less records.
  WITH candidates AS (
    SELECT id FROM public.agent_memory
    WHERE created_at < now() - interval '30 days'
      AND reviewed_at IS NULL AND outcome IS NULL
      AND input_data IS NOT NULL AND input_data <> '{}'::jsonb
    ORDER BY id LIMIT 250 FOR UPDATE SKIP LOCKED
  )
  UPDATE public.agent_memory SET input_data='{}'::jsonb
  WHERE id IN (SELECT id FROM candidates);
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END $$;
REVOKE ALL ON FUNCTION public.alphaos_trim_stale_agent_payloads() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.alphaos_trim_stale_agent_payloads() TO service_role;

