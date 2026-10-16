-- Attribution only: never replay alerts or recompute prices, samples or outcomes.
-- An ownership balance / caller-supplied wallet is not developer identity proof.
create function public.alpha_verified_outcome_pons_creator(p_token text) returns text
language sql stable security invoker set search_path='' as $$
 select case when count(distinct lower(deployer_address))=1 then min(lower(deployer_address)) end
 from public.pons_launches
 where chain='robinhood' and protocol='pons' and token_address=lower(p_token)
 and factory_address in (
 '0x0c37a24f5d23a486fa692d1500881d698b1f77a4',
 '0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb',
 '0x7e1eabd52ae29598e6483f72dcf1a70b14284db8',
 '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e')
 and deployer_address ~* '^0x[a-f0-9]{40}$'
 and lower(deployer_address)<>'0x0000000000000000000000000000000000000000'
 and transaction_hash ~* '^0x[a-f0-9]{64}$' and block_number>=0 and log_index>=0;
$$;

create function public.alpha_link_compact_pons_creator(p_token text) returns text
language plpgsql security invoker set search_path='' set lock_timeout='100ms' as $$
declare
 v_token text:=lower(p_token); v_creator text; t public.alpha_compact_tracking;
 w public.alpha_successful_tokens; v_tracking boolean; v_winner boolean;
 v_count boolean:=false; v_outcome text; v_at timestamptz;
begin
 if v_token is null or v_token !~ '^0x[a-f0-9]{40}$' then return 'INVALID'; end if;
 v_creator:=public.alpha_verified_outcome_pons_creator(v_token);
 if v_creator is null then return 'UNVERIFIED'; end if;
 -- Same lock order as finalization: tracking, then winner. A skipped row must
 -- never be mistaken for an expired row and counted as an orphan winner.
 select * into t from public.alpha_compact_tracking where chain='robinhood' and token=v_token for update skip locked;
 v_tracking:=found;
 if not v_tracking and exists(select 1 from public.alpha_compact_tracking where chain='robinhood' and token=v_token) then return 'BUSY'; end if;
 select * into w from public.alpha_successful_tokens where chain='robinhood' and token=v_token for update skip locked;
 v_winner:=found;
 if not v_winner and exists(select 1 from public.alpha_successful_tokens where chain='robinhood' and token=v_token) then return 'BUSY'; end if;
 if not v_tracking and not v_winner then return 'NOT_TRACKED'; end if;
 if (t.creator is not null and (lower(t.creator)<>v_creator or coalesce(t.creator_source,'') not in ('PONS_FACTORY_EVENT','CHAIN_DEPLOYMENT_RECEIPT')))
 or (w.creator is not null and (lower(w.creator)<>v_creator or coalesce(w.creator_source,'') not in ('PONS_FACTORY_EVENT','CHAIN_DEPLOYMENT_RECEIPT')))
 or (v_tracking and v_winner and (t.finalized_at is null or t.outcome is distinct from 'WINNER'))
 or (v_tracking and t.creator is null and w.creator is not null)
 then return 'CONFLICT'; end if;
 if (not v_tracking or t.creator is not null) and (not v_winner or w.creator is not null) then return 'ALREADY_LINKED'; end if;
 if v_tracking and t.creator is null then
  if t.finalized_at is not null and coalesce(t.outcome,'') not in ('WINNER','FAILED','NEUTRAL','INCOMPLETE') then return 'CONFLICT'; end if;
  update public.alpha_compact_tracking set creator=v_creator,creator_source='PONS_FACTORY_EVENT' where chain='robinhood' and token=v_token and creator is null;
  -- Active sessions are counted later by the existing locked finalizer.
  v_count:=t.finalized_at is not null; v_outcome:=t.outcome; v_at:=t.finalized_at;
 end if;
 if v_winner and w.creator is null then
  update public.alpha_successful_tokens set creator=v_creator,creator_source='PONS_FACTORY_EVENT' where chain='robinhood' and token=v_token and creator is null;
  if not v_tracking then v_count:=true; v_outcome:='WINNER'; v_at:=w.assessed_at; end if;
 end if;
 if v_count then
  insert into public.alpha_creator_outcome_summary(chain,creator,assessed_sessions,winners,failed,neutral,incomplete,last_assessed_at)
  values('robinhood',v_creator,1,(v_outcome='WINNER')::int,(v_outcome='FAILED')::int,(v_outcome='NEUTRAL')::int,(v_outcome='INCOMPLETE')::int,v_at)
  on conflict(chain,creator) do update set
   assessed_sessions=alpha_creator_outcome_summary.assessed_sessions+1,
   winners=alpha_creator_outcome_summary.winners+excluded.winners,
   failed=alpha_creator_outcome_summary.failed+excluded.failed,
   neutral=alpha_creator_outcome_summary.neutral+excluded.neutral,
   incomplete=alpha_creator_outcome_summary.incomplete+excluded.incomplete,
   last_assessed_at=greatest(alpha_creator_outcome_summary.last_assessed_at,excluded.last_assessed_at);
 end if;
 return case when v_count then 'LINKED_COMPLETED' when v_tracking and t.finalized_at is null then 'LINKED_ACTIVE' else 'LINKED_WINNER_COPY' end;
end $$;

-- Bounded reconciliation handles proof arriving after the original admission,
-- REUSED / KNOWN_WINNER and registration's six-hour process cache.
create function public.alpha_reconcile_compact_creators(p_limit integer default 25) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='100ms' as $$
declare x record; v_status text; v_counts jsonb:='{}';
begin
 if p_limit is null or p_limit<1 or p_limit>25 then raise exception 'Invalid attribution batch'; end if;
 if not pg_try_advisory_xact_lock(84020261016::bigint) then return '{"BUSY":1}'::jsonb; end if;
 for x in
  select candidates.token from (
   select token from public.alpha_compact_tracking where chain='robinhood' and creator is null
   union select token from public.alpha_successful_tokens where chain='robinhood' and creator is null
  ) candidates
  where public.alpha_verified_outcome_pons_creator(candidates.token) is not null
  order by candidates.token limit p_limit
 loop
  v_status:=public.alpha_link_compact_pons_creator(x.token);
  v_counts:=jsonb_set(v_counts,array[v_status],to_jsonb(coalesce((v_counts->>v_status)::int,0)+1));
 end loop;
 return v_counts;
end $$;

revoke execute on function public.alpha_verified_outcome_pons_creator(text),public.alpha_link_compact_pons_creator(text),public.alpha_reconcile_compact_creators(integer) from public,anon,authenticated;
grant execute on function public.alpha_verified_outcome_pons_creator(text),public.alpha_link_compact_pons_creator(text),public.alpha_reconcile_compact_creators(integer) to service_role;
