-- Small evidence/attempt ledger; no raw receipts or chain history retained.
create table public.alpha_deployment_creator_evidence (
 chain text not null check(chain in ('robinhood','arc')),token text not null check(token ~ '^0x[a-f0-9]{40}$'),
 status text not null check(status in ('PENDING','UNVERIFIED','VERIFIED')),
 checked_at timestamptz not null default now(),next_check_at timestamptz not null default now()+interval '24 hours',
 lease uuid not null, creator text,transaction_hash text,block_number bigint,block_hash text,
 primary key(chain,token),
 check(status<>'VERIFIED' or (creator is not null and transaction_hash is not null and block_number is not null and block_hash is not null and creator ~ '^0x[a-f0-9]{40}$' and creator<>'0x0000000000000000000000000000000000000000' and transaction_hash ~ '^0x[a-f0-9]{64}$' and block_number>=0 and block_hash ~ '^0x[a-f0-9]{64}$'))
);
create index alpha_deployment_creator_checked on public.alpha_deployment_creator_evidence(checked_at);
alter table public.alpha_deployment_creator_evidence enable row level security;
revoke all on public.alpha_deployment_creator_evidence from public,anon,authenticated;
grant select,insert,update,delete on public.alpha_deployment_creator_evidence to service_role;

create function public.alpha_link_compact_creator(p_chain text,p_token text) returns text
language plpgsql security invoker set search_path='' set lock_timeout='100ms' as $$
declare
 v_token text:=lower(p_token); v_creator text; v_source text; t public.alpha_compact_tracking;
 w public.alpha_successful_tokens; v_tracking boolean; v_winner boolean;
 v_count boolean:=false; v_outcome text; v_at timestamptz;
begin
 if p_chain is null or p_chain not in ('robinhood','arc') or v_token is null or v_token !~ '^0x[a-f0-9]{40}$' then return 'INVALID'; end if;
 v_creator:=case when p_chain='robinhood' then public.alpha_verified_outcome_pons_creator(v_token) end;
 v_source:='PONS_FACTORY_EVENT';
 if v_creator is null then
  select creator into v_creator from public.alpha_deployment_creator_evidence where chain=p_chain and token=v_token and status='VERIFIED';
  v_source:='CHAIN_DEPLOYMENT_RECEIPT';
 end if;
 if v_creator is null then return 'UNVERIFIED'; end if;
 -- Same lock order as finalization: tracking, then winner. A skipped row must
 -- never be mistaken for an expired row and counted as an orphan winner.
 select * into t from public.alpha_compact_tracking where chain=p_chain and token=v_token for update skip locked;
 v_tracking:=found;
 if not v_tracking and exists(select 1 from public.alpha_compact_tracking where chain=p_chain and token=v_token) then return 'BUSY'; end if;
 select * into w from public.alpha_successful_tokens where chain=p_chain and token=v_token for update skip locked;
 v_winner:=found;
 if not v_winner and exists(select 1 from public.alpha_successful_tokens where chain=p_chain and token=v_token) then return 'BUSY'; end if;
 if not v_tracking and not v_winner then return 'NOT_TRACKED'; end if;
 if (t.creator is not null and (lower(t.creator)<>v_creator or coalesce(t.creator_source,'') not in ('PONS_FACTORY_EVENT','CHAIN_DEPLOYMENT_RECEIPT')))
 or (w.creator is not null and (lower(w.creator)<>v_creator or coalesce(w.creator_source,'') not in ('PONS_FACTORY_EVENT','CHAIN_DEPLOYMENT_RECEIPT')))
 or (v_tracking and v_winner and (t.finalized_at is null or t.outcome is distinct from 'WINNER'))
 or (v_tracking and t.creator is null and w.creator is not null)
 then return 'CONFLICT'; end if;
 if (not v_tracking or t.creator is not null) and (not v_winner or w.creator is not null) then return 'ALREADY_LINKED'; end if;
 if v_tracking and t.creator is null then
  if t.finalized_at is not null and coalesce(t.outcome,'') not in ('WINNER','FAILED','NEUTRAL','INCOMPLETE') then return 'CONFLICT'; end if;
  update public.alpha_compact_tracking set creator=v_creator,creator_source=v_source where chain=p_chain and token=v_token and creator is null;
  -- Active sessions are counted later by the existing locked finalizer.
  v_count:=t.finalized_at is not null; v_outcome:=t.outcome; v_at:=t.finalized_at;
 end if;
 if v_winner and w.creator is null then
  update public.alpha_successful_tokens set creator=v_creator,creator_source=v_source where chain=p_chain and token=v_token and creator is null;
  if not v_tracking then v_count:=true; v_outcome:='WINNER'; v_at:=w.assessed_at; end if;
 end if;
 if v_count then
  insert into public.alpha_creator_outcome_summary(chain,creator,assessed_sessions,winners,failed,neutral,incomplete,last_assessed_at)
  values(p_chain,v_creator,1,(v_outcome='WINNER')::int,(v_outcome='FAILED')::int,(v_outcome='NEUTRAL')::int,(v_outcome='INCOMPLETE')::int,v_at)
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

create or replace function public.alpha_reconcile_compact_creators(p_limit integer default 25) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='100ms' as $$
declare x record; v_status text; v_counts jsonb:='{}';
begin
 if p_limit is null or p_limit<1 or p_limit>25 then raise exception 'Invalid attribution batch'; end if;
 if not pg_try_advisory_xact_lock(84020261016::bigint) then return '{"BUSY":1}'::jsonb; end if;
 for x in
  select candidates.chain,candidates.token from (
   select chain,token from public.alpha_compact_tracking where chain in ('robinhood','arc') and creator is null
   union select chain,token from public.alpha_successful_tokens where chain in ('robinhood','arc') and creator is null
  ) candidates
  where (candidates.chain='robinhood' and public.alpha_verified_outcome_pons_creator(candidates.token) is not null)
   or exists(select 1 from public.alpha_deployment_creator_evidence e where e.chain=candidates.chain and e.token=candidates.token and e.status='VERIFIED')
  order by candidates.chain,candidates.token limit p_limit
 loop
  v_status:=public.alpha_link_compact_creator(x.chain,x.token);
  v_counts:=jsonb_set(v_counts,array[v_status],to_jsonb(coalesce((v_counts->>v_status)::int,0)+1));
 end loop;
 return v_counts;
end $$;


-- Atomic global budget across replicas/restarts: at most one claimed token / 10m.
create function public.alpha_claim_creator_verification() returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='100ms' as $$
declare x record; v_lease uuid:=gen_random_uuid();
begin
 if not pg_try_advisory_xact_lock(84020261017::bigint) then return null; end if;
 if exists(select 1 from public.alpha_deployment_creator_evidence where checked_at>now()-interval '10 minutes') then return null; end if;
 delete from public.alpha_deployment_creator_evidence e where checked_at<now()-interval '7 days'
 and not exists(select 1 from public.alpha_successful_tokens w where w.chain=e.chain and w.token=e.token)
 and not exists(select 1 from public.alpha_compact_tracking t where t.chain=e.chain and t.token=e.token);
 select c.chain,c.token into x from (
  select chain,token,min(priority) priority from (
   select chain,token,case when finalized_at is null then 0 else 2 end priority from public.alpha_compact_tracking where creator is null and chain in ('robinhood','arc')
   union all select chain,token,1 from public.alpha_successful_tokens where creator is null and chain in ('robinhood','arc')
  ) targets group by chain,token
 ) c left join public.alpha_deployment_creator_evidence e on e.chain=c.chain and e.token=c.token
 where (e.token is null or (e.status<>'VERIFIED' and e.next_check_at<=now()))
 and (e.token is not null or (select count(*) from public.alpha_deployment_creator_evidence where status<>'VERIFIED')<200)
 and (c.chain<>'robinhood' or public.alpha_verified_outcome_pons_creator(c.token) is null)
 order by c.priority,e.checked_at nulls first,c.chain,c.token limit 1;
 if not found then return null; end if;
 insert into public.alpha_deployment_creator_evidence(chain,token,status,lease) values(x.chain,x.token,'PENDING',v_lease)
 on conflict(chain,token) do update set status='PENDING',lease=v_lease,checked_at=now(),next_check_at=now()+interval '24 hours';
 return jsonb_build_object('chain',x.chain,'token',x.token,'lease',v_lease);
end $$;

create function public.alpha_finish_creator_verification(p_chain text,p_token text,p_lease uuid,p_proof jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='100ms' as $$
declare e public.alpha_deployment_creator_evidence; v_link text;
begin
 select * into e from public.alpha_deployment_creator_evidence where chain=p_chain and token=p_token and lease=p_lease and status='PENDING' for update;
 if not found then return '{"status":"STALE"}'; end if;
 if p_proof is null then
  update public.alpha_deployment_creator_evidence set status='UNVERIFIED' where chain=p_chain and token=p_token;
  return '{"status":"UNVERIFIED"}';
 end if;
 if jsonb_typeof(p_proof)<>'object' or pg_column_size(p_proof)>1024
 or coalesce(p_proof->>'chain','')<>p_chain or coalesce(p_proof->>'token','')<>p_token
 or coalesce(p_proof->>'source','')<>'CHAIN_DEPLOYMENT_RECEIPT'
 or coalesce(p_proof->>'creator','') !~ '^0x[a-f0-9]{40}$' or p_proof->>'creator'='0x0000000000000000000000000000000000000000'
 or coalesce(p_proof->>'transactionHash','') !~ '^0x[a-f0-9]{64}$'
 or coalesce(p_proof->>'blockHash','') !~ '^0x[a-f0-9]{64}$'
 or coalesce(p_proof->>'blockNumber','') !~ '^[0-9]{1,18}$' then raise exception 'Invalid deployment proof'; end if;
 update public.alpha_deployment_creator_evidence set status='VERIFIED',creator=p_proof->>'creator',transaction_hash=p_proof->>'transactionHash',block_number=(p_proof->>'blockNumber')::bigint,block_hash=p_proof->>'blockHash' where chain=p_chain and token=p_token;
 v_link:=public.alpha_link_compact_creator(p_chain,p_token);
 return jsonb_build_object('status','VERIFIED','link',v_link);
end $$;
revoke execute on function public.alpha_link_compact_creator(text,text),public.alpha_claim_creator_verification(),public.alpha_finish_creator_verification(text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.alpha_link_compact_creator(text,text),public.alpha_claim_creator_verification(),public.alpha_finish_creator_verification(text,text,uuid,jsonb) to service_role;
