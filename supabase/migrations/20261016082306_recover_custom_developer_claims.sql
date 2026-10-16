-- A timed-out claim may commit without returning its lease. Reclaim it at
-- the next global ten-minute slot; a new lease fences any stale response.
create or replace function public.alpha_claim_creator_verification() returns jsonb
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
 where (e.token is null or (e.status='PENDING' or (e.status='UNVERIFIED' and e.next_check_at<=now())))
 and (e.token is not null or (select count(*) from public.alpha_deployment_creator_evidence where status<>'VERIFIED')<200)
 and (c.chain<>'robinhood' or public.alpha_verified_outcome_pons_creator(c.token) is null)
 order by c.priority,e.checked_at nulls first,c.chain,c.token limit 1;
 if not found then return null; end if;
 insert into public.alpha_deployment_creator_evidence(chain,token,status,lease) values(x.chain,x.token,'PENDING',v_lease)
 on conflict(chain,token) do update set status='PENDING',lease=v_lease,checked_at=now(),next_check_at=now()+interval '24 hours';
 return jsonb_build_object('chain',x.chain,'token',x.token,'lease',v_lease);
end $$;

