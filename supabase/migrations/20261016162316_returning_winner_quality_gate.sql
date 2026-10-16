create or replace function public.alpha_winner_sample_valid(samples jsonb,baseline double precision,roi double precision,low_roi double precision,assessed timestamptz) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare i integer; p double precision; r double precision; last_r double precision; low_r double precision:=0; t timestamptz; previous_t timestamptz;
begin
 if jsonb_typeof(samples)<>'array' or jsonb_array_length(samples)<>3 or baseline is null or baseline<=0 or baseline>='Infinity'::float8 or assessed is null then return false; end if;
 for i in 0..2 loop
  if samples->i->>'status'<>'MEASURED' or jsonb_typeof(samples->i->'price')<>'number' or jsonb_typeof(samples->i->'at')<>'string' then return false;end if;
  p:=(samples->i->>'price')::double precision;t:=(samples->i->>'at')::timestamptz;
  if p is null or p<=0 or p>='Infinity'::float8 or t is null or (previous_t is not null and t<=previous_t) or t>assessed+interval '30 seconds' then return false;end if;
  r:=(p/baseline-1)*100;low_r:=least(low_r,r);last_r:=r;previous_t:=t;
 end loop;
 return roi is not null and low_roi is not null and last_r>=25 and low_r>=-30
 and abs(last_r-roi)<1e-6*greatest(1,abs(last_r)) and abs(low_r-low_roi)<1e-6*greatest(1,abs(low_r));
exception when others then return false;
end $$;
revoke execute on function public.alpha_winner_sample_valid(jsonb,double precision,double precision,double precision,timestamptz) from public,anon,authenticated;
grant execute on function public.alpha_winner_sample_valid(jsonb,double precision,double precision,double precision,timestamptz) to service_role;

-- Discovery-only qualification. Read bounded indexed census rows for at most
-- 1000 developers, only on the existing five-minute history refresh.
create or replace function public.alpha_returning_winner_history_for(p_creator text) returns jsonb
language sql stable security invoker set search_path='' as $$
 with creators as materialized (
  select s.* from public.alpha_creator_outcome_summary s
  where s.chain='robinhood' and s.winners>=3 and (p_creator is null or s.creator=p_creator)
  and s.creator ~ '^0x[a-f0-9]{40}$' and s.creator<>'0x0000000000000000000000000000000000000000'
  and s.assessed_sessions=s.winners+s.failed+s.neutral+s.incomplete
  and least(s.winners,s.failed,s.neutral,s.incomplete)>=0
  and not exists(select 1 from public.alpha_reviewed_token_risk r where r.chain=s.chain and r.creator=s.creator and r.status='CONFIRMED_HARMFUL')
  and not exists(select 1 from public.alpha_successful_tokens w join public.alpha_reviewed_token_risk r on r.chain=w.chain and r.token=w.token and r.status='CONFIRMED_HARMFUL' where w.chain=s.chain and w.creator=s.creator)
  order by s.last_assessed_at desc,s.creator limit 1000
 ), launch_samples as materialized (
  select c.creator,p.token_address,p.block_timestamp,p.factory_address,p.protocol_version,p.block_number
  from creators c cross join lateral (
   select token_address,block_timestamp,factory_address,protocol_version,block_number
   from public.pons_launches p where p.chain='robinhood' and p.deployer_address=c.creator and p.protocol='pons'
   and p.block_timestamp<=now()
   order by p.block_timestamp desc limit 51
  )p
 ), launch_counts as (
  select creator,count(*) as indexed_rows,count(distinct token_address) as known_launches,
   count(distinct token_address) filter(where block_timestamp>=now()-interval '24 hours') as launches_24h
  from launch_samples group by creator
 ), qualified_launchers as materialized (
  select c.*,l.known_launches,l.launches_24h from creators c join launch_counts l using(creator)
  where l.indexed_rows<50 and l.known_launches>=3 and l.launches_24h<=5
 ), valid_winners as materialized (
  select w.chain,w.token,w.creator,w.creator_source,w.price_unit,w.baseline_price,w.final_roi,w.sampled_low_roi,w.samples,w.assessed_at
  from public.alpha_successful_tokens w join qualified_launchers c on c.chain=w.chain and c.creator=w.creator
  where w.creator_source='PONS_FACTORY_EVENT'
  and exists(select 1 from launch_samples p where p.creator=w.creator and p.token_address=w.token
   and ((p.factory_address='0x0c37a24f5d23a486fa692d1500881d698b1f77a4' and p.protocol_version='v1-legacy' and p.block_number>=8600612)
    or (p.factory_address='0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb' and p.protocol_version='v1-active' and p.block_number>=8991118)
    or (p.factory_address='0x7e1eabd52ae29598e6483f72dcf1a70b14284db8' and p.protocol_version='v2-old' and p.block_number>=24364906)
    or (p.factory_address='0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e' and p.protocol_version='v2-current' and p.block_number>=27027321)))
  and w.price_unit in ('USD','ETH_RESERVE_RATIO') and w.baseline_price>0 and w.baseline_price<'Infinity'::float8
  and w.final_roi>=25 and w.final_roi<'Infinity'::float8 and w.sampled_low_roi>=-30 and w.sampled_low_roi<=0
  and w.assessed_at<=now()
  and public.alpha_winner_sample_valid(w.samples,w.baseline_price,w.final_roi,w.sampled_low_roi,w.assessed_at)
  and not exists(select 1 from public.alpha_reviewed_token_risk r where r.chain=w.chain and r.token=w.token and r.status='CONFIRMED_HARMFUL')
 ), winner_counts as (
  select creator,count(distinct token) as verified_winning_tokens from valid_winners group by creator
 ), histories as (
  select c.*,v.verified_winning_tokens,
   (select jsonb_agg(to_jsonb(p) order by p.assessed_at desc,p.token) from (
    (select * from valid_winners w where w.creator=c.creator order by w.assessed_at asc,w.token limit 1)
    union
    (select * from valid_winners w where w.creator=c.creator order by w.assessed_at desc,w.token limit 2)
   )p) as prior_winners
  from qualified_launchers c join winner_counts v using(creator)
  where v.verified_winning_tokens>=3 and v.verified_winning_tokens*5>=c.known_launches*3
 ) select jsonb_build_object('policy_version',2,'as_of',now(),'capped',(select count(*)>=1000 from creators),
  'developers',coalesce((select jsonb_agg(to_jsonb(h) order by h.creator) from histories h),'[]'::jsonb));
$$;
revoke execute on function public.alpha_returning_winner_history_for(text) from public,anon,authenticated;
grant execute on function public.alpha_returning_winner_history_for(text) to service_role;
create or replace function public.alpha_returning_winner_history() returns jsonb
language sql stable security invoker set search_path='' as $$ select public.alpha_returning_winner_history_for(null); $$;
revoke execute on function public.alpha_returning_winner_history() from public,anon,authenticated;
grant execute on function public.alpha_returning_winner_history() to service_role;
create or replace function public.alpha_returning_winner_launch_history(p_creator text,p_token text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when exists(select 1 from public.pons_launches where chain='robinhood' and token_address=p_token and deployer_address=p_creator and protocol='pons' and block_timestamp between now()-interval '10 minutes' and now()+interval '30 seconds')
 then public.alpha_returning_winner_history_for(p_creator)
 else jsonb_build_object('policy_version',2,'as_of',now(),'capped',false,'developers','[]'::jsonb) end;
$$;
revoke execute on function public.alpha_returning_winner_launch_history(text,text) from public,anon,authenticated;
grant execute on function public.alpha_returning_winner_launch_history(text,text) to service_role;
