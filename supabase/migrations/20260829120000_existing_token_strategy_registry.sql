-- Register the continuous existing-token intelligence strategies required by
-- opportunities.strategy_key. This is forward-only and preserves the FK.
insert into public.strategy_registry (
  strategy_key, name, description, chain, category, enabled,
  user_visible, default_user_enabled, execution_mode, default_action,
  priority, config
)
values
  ('EXISTING_TOKEN_MONITOR', 'Existing Token Monitor',
   'Internal bounded monitoring of comparable existing-token observations and intelligence state.',
   'robinhood', 'intelligence', true, false, false, 'manual', 'TRACK', 70,
   '{"user_facing":false,"trading":false}'::jsonb),
  ('EXISTING_TOKEN_BREAKOUT', 'Existing Token Breakout',
   'Existing-token structure advanced into a qualified breakout requiring manual entry review.',
   'robinhood', 'momentum', true, true, true, 'manual', 'CHECK_ENTRY', 71,
   '{"user_facing":true,"trading":false}'::jsonb),
  ('EXISTING_TOKEN_REIGNITION', 'Existing Token Reignition',
   'Previously cooling existing-token structure regained verified healthy momentum.',
   'robinhood', 'momentum', true, true, true, 'manual', 'CHECK_ENTRY', 72,
   '{"user_facing":true,"trading":false}'::jsonb),
  ('EXISTING_TOKEN_RUNNER', 'Existing Token Runner',
   'Sustained existing-token structure advanced into a qualified runner state.',
   'robinhood', 'momentum', true, true, true, 'manual', 'CHECK_ENTRY', 73,
   '{"user_facing":true,"trading":false}'::jsonb)
on conflict (strategy_key) do update set
  name = excluded.name,
  description = excluded.description,
  chain = excluded.chain,
  category = excluded.category,
  enabled = excluded.enabled,
  user_visible = excluded.user_visible,
  default_user_enabled = excluded.default_user_enabled,
  execution_mode = excluded.execution_mode,
  default_action = excluded.default_action,
  priority = excluded.priority,
  config = excluded.config,
  updated_at = now();

-- Select only user-facing outcome categories that actually have a due,
-- missing checkpoint. Internal lifecycle volume and already-complete events
-- never consume the worker's 200-event budget.
create or replace function public.select_alpha_outcome_candidates(
  p_oldest timestamptz,
  p_latest timestamptz,
  p_now timestamptz,
  p_limit integer default 200
)
returns table (
  id bigint, asset_id text, chain text, price numeric, alerted_at timestamptz,
  semantic_event_type text, alert_type text
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id::bigint, e.asset_id::text, e.chain::text, e.price::numeric, e.alerted_at,
    e.semantic_event_type::text, e.alert_type::text
  from public.alpha_alert_events e
  where e.alerted_at >= p_oldest
    and e.alerted_at <= p_latest
    and (
      upper(coalesce(e.semantic_event_type, '')) in ('DEX_PAID','BOOST','VOLUME_SURGE','DEV_BURN','DEV_SELL','LIQUIDITY_RISK')
      or upper(coalesce(e.alert_type, '')) in ('ENTRY','CHECK_ENTRY','OPPORTUNITY')
    )
    and exists (
      select 1
      from unnest(array[30,60,180,300,900,1800,3600]) as due(checkpoint_seconds)
      where e.alerted_at <= p_now - make_interval(secs => due.checkpoint_seconds)
        and not exists (
          select 1 from public.alpha_alert_outcomes o
          where o.alert_event_id = e.id
            and o.checkpoint_seconds = due.checkpoint_seconds
        )
    )
  order by e.alerted_at asc
  limit greatest(1, least(coalesce(p_limit, 200), 200));
$$;

revoke all on function public.select_alpha_outcome_candidates(timestamptz,timestamptz,timestamptz,integer) from public;
revoke all on function public.select_alpha_outcome_candidates(timestamptz,timestamptz,timestamptz,integer) from anon;
revoke all on function public.select_alpha_outcome_candidates(timestamptz,timestamptz,timestamptz,integer) from authenticated;
grant execute on function public.select_alpha_outcome_candidates(timestamptz,timestamptz,timestamptz,integer) to service_role;
