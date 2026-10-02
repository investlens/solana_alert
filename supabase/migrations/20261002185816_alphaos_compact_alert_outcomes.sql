create table public.alpha_compact_tracking (
 chain text not null check (chain in ('solana','robinhood','arc')), token text not null,
 feed text not null check(length(feed)<=64), creator text, creator_source text,
 pair_id text not null, price_unit text not null check(price_unit in ('USD','ETH_RESERVE_RATIO')),
 baseline_price double precision not null check(baseline_price>0 and baseline_price<'Infinity'::float8),
 baseline_mc double precision, baseline_liquidity double precision,
 started_at timestamptz not null default now(), due_at timestamptz not null default now()+interval '15 minutes',
 checkpoint integer not null default 0 check(checkpoint between 0 and 3), retried boolean not null default false,
 samples jsonb not null default '[]' check(jsonb_typeof(samples)='array' and jsonb_array_length(samples)<=3 and pg_column_size(samples)<=4096),
 lease uuid, lease_until timestamptz, finalized_at timestamptz,
 outcome text check(outcome in ('WINNER','FAILED','NEUTRAL','INCOMPLETE')),
 primary key(chain,token)
);
create index alpha_compact_due on public.alpha_compact_tracking(due_at) where finalized_at is null;
create index alpha_compact_retention on public.alpha_compact_tracking(finalized_at) where finalized_at is not null;
create table public.alpha_successful_tokens (
 chain text not null,token text not null,feed text not null,creator text,creator_source text,
 price_unit text not null,baseline_price double precision not null,final_roi double precision not null,
 sampled_peak_roi double precision not null,sampled_low_roi double precision not null,
 samples jsonb not null,assessed_at timestamptz not null default now(), primary key(chain,token)
);
create table public.alpha_creator_outcome_summary (
 chain text not null,creator text not null,assessed_sessions bigint not null default 0,
 winners bigint not null default 0,failed bigint not null default 0,neutral bigint not null default 0,
 incomplete bigint not null default 0,last_assessed_at timestamptz not null default now(),primary key(chain,creator)
);
create table public.alpha_feed_outcome_daily (
 day date not null,chain text not null,feed text not null,tracked bigint not null default 0,
 winners bigint not null default 0,failed bigint not null default 0,neutral bigint not null default 0,
 incomplete bigint not null default 0,excluded bigint not null default 0,primary key(day,chain,feed)
);
-- No public clients can read or write these operational records.
alter table public.alpha_compact_tracking enable row level security;
alter table public.alpha_successful_tokens enable row level security;
alter table public.alpha_creator_outcome_summary enable row level security;
alter table public.alpha_feed_outcome_daily enable row level security;
revoke all on public.alpha_compact_tracking,public.alpha_successful_tokens,public.alpha_creator_outcome_summary,public.alpha_feed_outcome_daily from anon,authenticated;
grant all on public.alpha_compact_tracking,public.alpha_successful_tokens,public.alpha_creator_outcome_summary,public.alpha_feed_outcome_daily to service_role;

create function public.alpha_register_compact_alert(p_chain text,p_token text,p_feed text,p_price double precision,p_mc double precision,p_liquidity double precision,p_pair text,p_unit text,p_creator text default null,p_creator_source text default null) returns text
language plpgsql security invoker set search_path='' as $$
declare v_token text; v_creator text;
begin
 if p_chain not in ('solana','robinhood','arc') or length(p_feed)>64 or p_feed is null then return 'INVALID'; end if;
 v_token:=case when p_chain='solana' then p_token else lower(p_token) end;
 if (p_chain='solana' and v_token !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$') or (p_chain<>'solana' and v_token !~ '^0x[a-f0-9]{40}$') or v_token is null then return 'INVALID'; end if;
 if p_price is null or p_price<=0 or p_price>='Infinity'::float8 or p_pair is null or length(p_pair)>90 or length(p_pair)<32 or p_unit not in ('USD','ETH_RESERVE_RATIO') then return 'NO_BASELINE'; end if;
 if p_unit='ETH_RESERVE_RATIO' and (p_chain<>'robinhood' or p_pair !~* '^0x[a-f0-9]{40}$') then return 'INVALID'; end if;
 perform pg_advisory_xact_lock(84020261003::bigint);
 if exists(select 1 from public.alpha_compact_tracking where chain=p_chain and token=v_token) then return 'REUSED'; end if;
 if exists(select 1 from public.alpha_successful_tokens where chain=p_chain and token=v_token) then return 'KNOWN_WINNER'; end if;
 if (select count(*) from public.alpha_compact_tracking where finalized_at is null)>=20 then return 'CAPACITY'; end if;
 if p_creator_source in ('PONS_FACTORY_EVENT','CHAIN_DEPLOYMENT_RECEIPT') and p_chain<>'solana' and p_creator ~* '^0x[a-f0-9]{40}$' then v_creator:=lower(p_creator); end if;
 insert into public.alpha_compact_tracking(chain,token,feed,creator,creator_source,pair_id,price_unit,baseline_price,baseline_mc,baseline_liquidity)
 values(p_chain,v_token,p_feed,v_creator,case when v_creator is not null then p_creator_source end,p_pair,p_unit,p_price,p_mc,p_liquidity);
 insert into public.alpha_feed_outcome_daily(day,chain,feed,tracked) values((now() at time zone 'UTC')::date,p_chain,p_feed,1)
 on conflict(day,chain,feed) do update set tracked=alpha_feed_outcome_daily.tracked+1;
 return 'REGISTERED';
end $$;

create function public.alpha_claim_compact_checks() returns setof public.alpha_compact_tracking
language sql security invoker set search_path='' as $$
 with due as(select chain,token from public.alpha_compact_tracking where finalized_at is null and due_at<=now() and (lease_until is null or lease_until<now()) order by due_at for update skip locked limit 2)
 update public.alpha_compact_tracking t set lease=gen_random_uuid(),lease_until=now()+interval '2 minutes' from due d where t.chain=d.chain and t.token=d.token returning t.*;
$$;

create function public.alpha_finish_compact_check(p_chain text,p_token text,p_lease uuid,p_sample jsonb,p_retry boolean default false) returns text
language plpgsql security invoker set search_path='' as $$
declare r public.alpha_compact_tracking; v_samples jsonb; v_outcome text; v_roi float8; v_peak float8; v_low float8; v_complete boolean; v_checkpoint int;
begin
 select * into r from public.alpha_compact_tracking where chain=p_chain and token=p_token and lease=p_lease and finalized_at is null for update;
 if not found then return 'STALE'; end if;
 if p_retry and not r.retried and now()<r.started_at+make_interval(mins=>case r.checkpoint when 0 then 15 when 1 then 60 else 360 end)+interval '5 minutes' then
  update public.alpha_compact_tracking set retried=true,due_at=now()+interval '1 minute',lease=null,lease_until=null where chain=p_chain and token=p_token;
  return 'RETRY';
 end if;
 if jsonb_typeof(p_sample)<>'object' or pg_column_size(p_sample)>1024 or p_sample->>'status' not in ('MEASURED','UNAVAILABLE') then raise exception 'Invalid compact sample'; end if;
 v_samples:=r.samples||jsonb_build_array(p_sample); v_checkpoint:=r.checkpoint+1;
 if v_checkpoint<3 then
  update public.alpha_compact_tracking set samples=v_samples,checkpoint=v_checkpoint,retried=false,due_at=r.started_at+make_interval(mins=>case v_checkpoint when 1 then 60 else 360 end),lease=null,lease_until=null where chain=p_chain and token=p_token;
  return 'CHECKPOINT';
 end if;
 select bool_and(s->>'status'='MEASURED' and (s->>'price')::float8>0), greatest(0,max(((s->>'price')::float8/r.baseline_price-1)*100)),least(0,min(((s->>'price')::float8/r.baseline_price-1)*100)) into v_complete,v_peak,v_low from jsonb_array_elements(v_samples) s;
 v_roi:=((v_samples->2->>'price')::float8/r.baseline_price-1)*100;
 v_outcome:=case when not coalesce(v_complete,false) or v_roi is null then 'INCOMPLETE' when v_roi>=25 and v_low>=-30 then 'WINNER' when v_roi<=-50 or v_low<=-80 then 'FAILED' else 'NEUTRAL' end;
 if v_outcome='WINNER' then
  insert into public.alpha_successful_tokens(chain,token,feed,creator,creator_source,price_unit,baseline_price,final_roi,sampled_peak_roi,sampled_low_roi,samples) values(r.chain,r.token,r.feed,r.creator,r.creator_source,r.price_unit,r.baseline_price,v_roi,v_peak,v_low,v_samples) on conflict(chain,token) do nothing;
 end if;
 if r.creator is not null then
  insert into public.alpha_creator_outcome_summary(chain,creator,assessed_sessions,winners,failed,neutral,incomplete) values(r.chain,r.creator,1,(v_outcome='WINNER')::int,(v_outcome='FAILED')::int,(v_outcome='NEUTRAL')::int,(v_outcome='INCOMPLETE')::int)
  on conflict(chain,creator) do update set assessed_sessions=alpha_creator_outcome_summary.assessed_sessions+1,winners=alpha_creator_outcome_summary.winners+excluded.winners,failed=alpha_creator_outcome_summary.failed+excluded.failed,neutral=alpha_creator_outcome_summary.neutral+excluded.neutral,incomplete=alpha_creator_outcome_summary.incomplete+excluded.incomplete,last_assessed_at=now();
 end if;
 insert into public.alpha_feed_outcome_daily(day,chain,feed,winners,failed,neutral,incomplete) values((r.started_at at time zone 'UTC')::date,r.chain,r.feed,(v_outcome='WINNER')::int,(v_outcome='FAILED')::int,(v_outcome='NEUTRAL')::int,(v_outcome='INCOMPLETE')::int)
 on conflict(day,chain,feed) do update set winners=alpha_feed_outcome_daily.winners+excluded.winners,failed=alpha_feed_outcome_daily.failed+excluded.failed,neutral=alpha_feed_outcome_daily.neutral+excluded.neutral,incomplete=alpha_feed_outcome_daily.incomplete+excluded.incomplete;
 update public.alpha_compact_tracking set samples=v_samples,checkpoint=3,outcome=v_outcome,finalized_at=now(),lease=null,lease_until=null where chain=p_chain and token=p_token;
 return v_outcome;
end $$;

create function public.alpha_compact_maintenance(p_excluded jsonb default '[]') returns integer
language plpgsql security invoker set search_path='' as $$
declare n integer; x jsonb;
begin
 if jsonb_typeof(p_excluded)<>'array' or jsonb_array_length(p_excluded)>32 then raise exception 'Invalid coverage batch'; end if;
 for x in select * from jsonb_array_elements(p_excluded) loop
  if x->>'chain' in ('solana','robinhood','arc') and length(x->>'feed')<=64 and (x->>'count')::bigint between 1 and 100000 then
   insert into public.alpha_feed_outcome_daily(day,chain,feed,excluded) values((now() at time zone 'UTC')::date,x->>'chain',x->>'feed',(x->>'count')::bigint)
   on conflict(day,chain,feed) do update set excluded=alpha_feed_outcome_daily.excluded+excluded.excluded;
  end if;
 end loop;
 delete from public.alpha_compact_tracking where finalized_at<now()-interval '7 days'; get diagnostics n=row_count;
 return n;
end $$;
revoke execute on function public.alpha_register_compact_alert(text,text,text,float8,float8,float8,text,text,text,text),public.alpha_claim_compact_checks(),public.alpha_finish_compact_check(text,text,uuid,jsonb,boolean),public.alpha_compact_maintenance(jsonb) from public,anon,authenticated;
grant execute on function public.alpha_register_compact_alert(text,text,text,float8,float8,float8,text,text,text,text),public.alpha_claim_compact_checks(),public.alpha_finish_compact_check(text,text,uuid,jsonb,boolean),public.alpha_compact_maintenance(jsonb) to service_role;
