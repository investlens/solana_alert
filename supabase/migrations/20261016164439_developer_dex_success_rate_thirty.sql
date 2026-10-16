create table public.alpha_pons_dex_reached (
 chain text not null default 'robinhood' check(chain='robinhood'),token text not null,
 creator text not null,factory text not null,pool text not null,
 source text not null check(source in ('PONS_V2_GRADUATED_MAPPED_POOL','PONS_V1_MAPPED_POOL')),
 observed_at timestamptz not null,primary key(chain,token),
 check(token ~ '^0x[a-f0-9]{40}$' and creator ~ '^0x[a-f0-9]{40}$' and factory ~ '^0x[a-f0-9]{40}$' and pool ~ '^0x([a-f0-9]{40}|[a-f0-9]{64})$')
);
create index alpha_pons_dex_reached_creator on public.alpha_pons_dex_reached(chain,creator,observed_at);
alter table public.alpha_pons_dex_reached enable row level security;
revoke all on public.alpha_pons_dex_reached from public,anon,authenticated;
grant select,insert on public.alpha_pons_dex_reached to service_role;
-- Observations arrive only from the existing exact-token official-pool venue verifier.
-- Price returns, paid DEX orders and generic secondary-pool listings are not proof.
create function public.alpha_record_pons_dex_reached(p_items jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare x jsonb; c text; f text; v text; inserted integer:=0;n integer;at_time timestamptz;
begin
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>10 then raise exception 'Invalid batch';end if;
 for x in select value from jsonb_array_elements(p_items) loop
  if coalesce(x->>'token','') !~ '^0x[a-f0-9]{40}$' or coalesce(x->>'pool','') !~ '^0x([a-f0-9]{40}|[a-f0-9]{64})$' or x->>'pool' in ('0x0000000000000000000000000000000000000000',x->>'token') then continue;end if;
  begin at_time:=(x->>'observed_at')::timestamptz;exception when others then continue;end;
  if at_time is null or not isfinite(at_time) or at_time>now()+interval '30 seconds' or at_time<now()-interval '5 minutes' then continue;end if;
  select case when count(distinct deployer_address)=1 and count(distinct factory_address)=1 then min(deployer_address) end,min(factory_address),min(protocol_version)
   into c,f,v from public.pons_launches where chain='robinhood' and protocol='pons' and token_address=x->>'token' and block_timestamp<=at_time;
  if c is null or c='0x0000000000000000000000000000000000000000' then continue;end if;
  if not exists(select 1 from public.pons_launches p where p.chain='robinhood' and p.token_address=x->>'token'
   and ((p.factory_address='0x0c37a24f5d23a486fa692d1500881d698b1f77a4' and p.protocol_version='v1-legacy' and p.block_number>=8600612)
    or (p.factory_address='0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb' and p.protocol_version='v1-active' and p.block_number>=8991118)
    or (p.factory_address='0x7e1eabd52ae29598e6483f72dcf1a70b14284db8' and p.protocol_version='v2-old' and p.block_number>=24364906)
    or (p.factory_address='0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e' and p.protocol_version='v2-current' and p.block_number>=27027321))) then continue;end if;
  if not ((v like 'v2-%' and x->>'source'='PONS_V2_GRADUATED_MAPPED_POOL') or (v like 'v1-%' and x->>'source'='PONS_V1_MAPPED_POOL')) then continue;end if;
  insert into public.alpha_pons_dex_reached(chain,token,creator,factory,pool,source,observed_at)
   values('robinhood',x->>'token',c,f,x->>'pool',x->>'source',at_time) on conflict(chain,token) do nothing;
  get diagnostics n=row_count;inserted:=inserted+n;
 end loop;return inserted;
end $$;
revoke execute on function public.alpha_record_pons_dex_reached(jsonb) from public,anon,authenticated;
grant execute on function public.alpha_record_pons_dex_reached(jsonb) to service_role;

create function public.alpha_pons_dex_history(p_creator text,p_token text) returns jsonb
language sql stable security invoker set search_path='' as $$
 with candidates as materialized (
  select creator from public.alpha_pons_dex_reached where chain='robinhood' and (p_creator is null or creator=p_creator)
  group by creator order by max(observed_at) desc limit 1000
 ), cutoffs as (
  select c.creator,case when p_token is null then now() else
   (select min(block_timestamp) from public.pons_launches where chain='robinhood' and token_address=p_token and deployer_address=c.creator and protocol='pons') end as cutoff
  from candidates c
 ), projects as materialized (
  select c.creator,p.token_address,min(p.block_timestamp) as launched_at from cutoffs c
   join public.pons_launches p on p.chain='robinhood' and p.deployer_address=c.creator and p.protocol='pons'
   and p.block_timestamp<c.cutoff and (p_token is null or p.token_address<>p_token)
  where c.cutoff is not null group by c.creator,p.token_address
 ), reached as materialized (
  select d.* from public.alpha_pons_dex_reached d join projects p on d.chain='robinhood' and p.creator=d.creator and p.token_address=d.token
   join cutoffs c on c.creator=d.creator where d.observed_at<c.cutoff
   and not exists(select 1 from public.pons_launches other where other.chain=d.chain and other.token_address=d.token and other.deployer_address<>d.creator)
 ), counts as (
  select p.creator,count(*) as known_launches,count(d.token) as dex_projects from projects p left join reached d on d.creator=p.creator and d.token=p.token_address group by p.creator
 ), histories as (
  select c.*,case when p_token is null then 'SHORTLIST' else 'PRIOR_LAUNCHES' end as history_scope,
   (select jsonb_agg(to_jsonb(r)) from ((select token,pool,source,observed_at from reached d where d.creator=c.creator order by observed_at asc,token limit 1) union (select token,pool,source,observed_at from reached d where d.creator=c.creator order by observed_at desc,token limit 2))r) as dex_references
  from counts c where c.dex_projects>0 and c.dex_projects*10 >= (case when p_token is null then greatest(c.known_launches-1,1) else c.known_launches end)*3
   and not exists(select 1 from public.alpha_reviewed_token_risk r where r.chain='robinhood' and r.creator=c.creator and r.status='CONFIRMED_HARMFUL')
   and not exists(select 1 from projects p join public.alpha_reviewed_token_risk r on r.chain='robinhood' and r.token=p.token_address and r.status='CONFIRMED_HARMFUL' where p.creator=c.creator)
 ) select jsonb_build_object('policy_version',4,'as_of',now(),'capped',(select count(*)>=1000 from candidates),'developers',coalesce((select jsonb_agg(to_jsonb(h)) from histories h),'[]'::jsonb));
$$;
revoke execute on function public.alpha_pons_dex_history(text,text) from public,anon,authenticated;
grant execute on function public.alpha_pons_dex_history(text,text) to service_role;
create or replace function public.alpha_returning_winner_history() returns jsonb
language sql stable security invoker set search_path='' as $$ select public.alpha_pons_dex_history(null,null); $$;
create or replace function public.alpha_returning_winner_launch_history(p_creator text,p_token text) returns jsonb
language sql stable security invoker set search_path='' as $$ select public.alpha_pons_dex_history(p_creator,p_token); $$;
-- Keep historical price-outcome helpers for audit, but never use them for this feed.
update public.strategy_registry set name='Developer DEX Track Record',description='New PONS launch by a developer with at least 30% of indexed prior projects verified on the official DEX pool.' where strategy_key='RH_RETURNING_WINNER_DEV';
