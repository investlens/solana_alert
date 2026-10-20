-- Worker-only research. Never writes shared winner or developer outcome tables.
create table public.alpha_prebond_research (
 event_identity text primary key check(length(event_identity) between 1 and 240),
 token text not null check(token ~ '^0x[a-f0-9]{40}$'),
 curve text not null check(curve ~ '^0x[a-f0-9]{40}$' and curve<>token),
 unit text not null default 'ETH_RESERVE_RATIO' check(unit='ETH_RESERVE_RATIO'),
 baseline_kind text not null default 'FIRST_POST_ACCEPTANCE_OBSERVATION' check(baseline_kind='FIRST_POST_ACCEPTANCE_OBSERVATION'),
 baseline_price float8 not null check(baseline_price>0 and baseline_price<'Infinity'::float8),
 baseline_block text not null check(baseline_block ~ '^[0-9]{1,30}$'),
 baseline_block_hash text not null check(baseline_block_hash ~ '^0x[a-f0-9]{64}$'),
 first_accepted_at timestamptz not null,
 started_at timestamptz not null check(isfinite(started_at) and started_at>=first_accepted_at),
 due_at timestamptz not null, checkpoint int not null default 0 check(checkpoint between 0 and 3),
 samples jsonb not null default '[]' check(jsonb_typeof(samples)='array' and jsonb_array_length(samples)<=3 and pg_column_size(samples)<=4096),
 lease uuid,lease_until timestamptz,last_claim_at timestamptz,created_at timestamptz not null default now(),
 finalized_at timestamptz,outcome text check(outcome in ('COMPLETE','INCOMPLETE','VENUE_TRANSITION')),
 sampled_change_pct float8,
 check((finalized_at is null)=(outcome is null))
);
create index alpha_prebond_research_due on public.alpha_prebond_research(due_at) where finalized_at is null;
create index alpha_prebond_research_retention on public.alpha_prebond_research(started_at);
alter table public.alpha_prebond_research enable row level security;
revoke all on public.alpha_prebond_research from public,anon,authenticated;
grant select,insert,update,delete on public.alpha_prebond_research to service_role;

create function public.alpha_register_prebond_research(p jsonb) returns text
language plpgsql security invoker set search_path='' set statement_timeout='2s' as $$
declare t timestamptz;a timestamptz;b public.alpha_promotion_baselines%rowtype;v_price float8;
begin
 if jsonb_typeof(p) is distinct from 'object' or pg_column_size(p)>2048 or exists(select 1 from jsonb_object_keys(p) k where k not in ('event_identity','token','curve','price','at','block','block_hash')) then raise exception 'Invalid research baseline';end if;
 if p->>'token' is null or p->>'token' !~ '^0x[a-f0-9]{40}$' or p->>'curve' is null or p->>'curve' !~ '^0x[a-f0-9]{40}$' or p->>'curve'=p->>'token'
 or p->>'block' is null or p->>'block' !~ '^[0-9]{1,30}$' or p->>'block_hash' is null or p->>'block_hash' !~ '^0x[a-f0-9]{64}$' then raise exception 'Invalid research identity';end if;
 t:=(p->>'at')::timestamptz;v_price:=(p->>'price')::float8;
 if t is null or not isfinite(t) or t>now()+interval '2 seconds' or t<now()-interval '30 seconds' or v_price is null or v_price<=0 or v_price>='Infinity'::float8 then raise exception 'Invalid research quote';end if;
 select * into b from public.alpha_promotion_baselines where event_identity=p->>'event_identity' and token=p->>'token' and reason='PRE_BOND_NO_COMPARABLE_DEX_BASELINE';
 if not found then return 'NO_ACCEPTED_BASELINE';end if;a:=b.first_accepted_at;
 if t<a or t>a+interval '2 minutes' then return 'OUTSIDE_ACCEPTANCE_WINDOW';end if;
 if not exists(select 1 from public.pons_launches l where l.token_address=p->>'token' and lower(l.curve_address)=p->>'curve' and l.chain='robinhood' and l.protocol='pons' and l.protocol_version like 'v2-%') then return 'UNVERIFIED_CURVE';end if;
 perform pg_advisory_xact_lock(84020261018::bigint);
 delete from public.alpha_prebond_research where event_identity in(select event_identity from public.alpha_prebond_research where started_at<now()-interval '7 days' order by started_at limit 10);
 if exists(select 1 from public.alpha_prebond_research where event_identity=p->>'event_identity') then return 'EXISTS';end if;
 if exists(select 1 from public.alpha_prebond_research where token=p->>'token' and finalized_at is null) then return 'REUSED';end if;
 if (select count(*) from public.alpha_prebond_research)>=200 or (select count(*) from public.alpha_prebond_research where finalized_at is null)>=10 then return 'CAPACITY';end if;
 if exists(select 1 from public.alpha_prebond_research where created_at>now()-interval '1 minute') then return 'RATE_LIMIT';end if;
 insert into public.alpha_prebond_research(event_identity,token,curve,baseline_price,baseline_block,baseline_block_hash,first_accepted_at,started_at,due_at)
 values(p->>'event_identity',p->>'token',p->>'curve',v_price,p->>'block',p->>'block_hash',a,t,t+interval '15 minutes');
 return 'REGISTERED';
end $$;

create function public.alpha_claim_prebond_research() returns setof public.alpha_prebond_research
language plpgsql security invoker set search_path='' set statement_timeout='2s' as $$
begin
 perform pg_advisory_xact_lock(84020261018::bigint);
 delete from public.alpha_prebond_research where event_identity in(select event_identity from public.alpha_prebond_research where started_at<now()-interval '7 days' order by started_at limit 10);
 if exists(select 1 from public.alpha_prebond_research where last_claim_at>now()-interval '1 minute') then return;end if;
 return query with due as(select event_identity from public.alpha_prebond_research where finalized_at is null and due_at<=now() and (lease_until is null or lease_until<now()) order by due_at for update skip locked limit 1)
 update public.alpha_prebond_research t set lease=gen_random_uuid(),lease_until=now()+interval '2 minutes',last_claim_at=now() from due d where t.event_identity=d.event_identity returning t.*;
end $$;

create function public.alpha_finish_prebond_research(p_event text,p_lease uuid,p_sample jsonb) returns text
language plpgsql security invoker set search_path='' set statement_timeout='2s' as $$
declare r public.alpha_prebond_research%rowtype;s jsonb;t timestamptz;v_price float8;v_samples jsonb;v_outcome text;v_next int;
begin
 select * into r from public.alpha_prebond_research where event_identity=p_event and lease=p_lease and finalized_at is null for update;
 if not found then return 'STALE';end if;
 if jsonb_typeof(p_sample) is distinct from 'object' or pg_column_size(p_sample)>1024 or exists(select 1 from jsonb_object_keys(p_sample) k where k not in ('status','price','at','block','block_hash','reason')) or p_sample->>'status' is null or p_sample->>'status' not in ('MEASURED','GRADUATED','UNAVAILABLE') then raise exception 'Invalid research sample';end if;
 t:=(p_sample->>'at')::timestamptz;v_price:=(p_sample->>'price')::float8;
 if t is null or not isfinite(t) or t>now()+interval '2 seconds' or t<now()-interval '30 seconds' or t<=r.started_at then raise exception 'Invalid research sample time';end if;
 if p_sample->>'status' in ('MEASURED','GRADUATED') and (p_sample->>'block' is null or p_sample->>'block' !~ '^[0-9]{1,30}$' or (p_sample->>'block')::numeric<=(r.baseline_block)::numeric or p_sample->>'block_hash' is null or p_sample->>'block_hash' !~ '^0x[a-f0-9]{64}$') then raise exception 'Invalid sample block';end if;
 if p_sample->>'status'='MEASURED' and (v_price is null or v_price<=0 or v_price>='Infinity'::float8) then raise exception 'Invalid sample price';end if;
 if p_sample->>'status'<>'MEASURED' and v_price is not null then raise exception 'Unexpected sample price';end if;
 if length(coalesce(p_sample->>'reason',''))>100 then raise exception 'Invalid sample reason';end if;
 s:=p_sample;
 if s->>'status'<>'GRADUATED' and (t<r.due_at or t>r.due_at+interval '5 minutes') then s:=jsonb_build_object('status','UNAVAILABLE','price',null,'at',t,'block',null,'block_hash',null,'reason','MISSED_CHECKPOINT_WINDOW');end if;
 if r.checkpoint>0 and t<=(r.samples->(r.checkpoint-1)->>'at')::timestamptz then raise exception 'Unordered sample';end if;
 v_samples:=r.samples||jsonb_build_array(s);v_next:=r.checkpoint+1;
 if s->>'status'='GRADUATED' then v_outcome:='VENUE_TRANSITION';
 elsif v_next=3 then v_outcome:=case when not exists(select 1 from jsonb_array_elements(v_samples) x where x->>'status'<>'MEASURED') then 'COMPLETE' else 'INCOMPLETE' end;end if;
 update public.alpha_prebond_research set samples=v_samples,checkpoint=v_next,lease=null,lease_until=null,
 due_at=case when v_next=1 then started_at+interval '1 hour' else started_at+interval '6 hours' end,
 finalized_at=case when v_outcome is not null then now() end,outcome=v_outcome,
 sampled_change_pct=case when v_outcome='COMPLETE' then ((s->>'price')::float8/baseline_price-1)*100 end
 where event_identity=p_event;
 return coalesce(v_outcome,'CHECKPOINT');
end $$;
revoke execute on function public.alpha_register_prebond_research(jsonb),public.alpha_claim_prebond_research(),public.alpha_finish_prebond_research(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.alpha_register_prebond_research(jsonb),public.alpha_claim_prebond_research(),public.alpha_finish_prebond_research(text,uuid,jsonb) to service_role;
