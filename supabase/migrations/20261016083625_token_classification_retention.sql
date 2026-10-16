-- Evidence-backed risk is separate from price performance. Backend review only;
-- provider flags, low prices and unlocked LP cannot populate this ledger.
create table public.alpha_reviewed_token_risk (
 chain text not null check(chain in ('robinhood','arc')),
 token text not null check(token ~ '^0x[a-f0-9]{40}$'),
 status text not null check(status in ('CONFIRMED_HARMFUL','RETRACTED')),
 reason text not null check(reason in ('REVIEWED_ONCHAIN_SELL_RESTRICTION','REVIEWED_ONCHAIN_EXPLOIT')),
 transaction_hash text not null check(transaction_hash ~ '^0x[a-f0-9]{64}$'),
 review_reference text not null check(length(trim(review_reference)) between 8 and 128),
 note text not null check(length(trim(note)) between 10 and 240),
 creator text,creator_source text,
 reviewed_at timestamptz not null default now(),
 primary key(chain,token),
 check((creator is null and creator_source is null) or
 (creator is not null and creator_source is not null and creator ~ '^0x[a-f0-9]{40}$'
 and creator<>'0x0000000000000000000000000000000000000000'
 and creator_source in ('PONS_FACTORY_EVENT','CHAIN_DEPLOYMENT_RECEIPT')))
);
alter table public.alpha_reviewed_token_risk enable row level security;
revoke all on public.alpha_reviewed_token_risk from public,anon,authenticated;
grant select,insert,update on public.alpha_reviewed_token_risk to service_role;

-- Explicit reviewed evidence, never an inference from returns or a provider flag.
-- Only resolve developer identity through our already-verified identity sources.
create function public.alpha_set_reviewed_token_risk(p_chain text,p_token text,p_status text,p_reason text,p_transaction_hash text,p_review_reference text,p_note text) returns text
language plpgsql security invoker set search_path='' as $$
declare v_token text:=lower(p_token); v_creator text; v_source text;
begin
 if p_chain is null or p_chain not in ('robinhood','arc') or v_token is null or v_token !~ '^0x[a-f0-9]{40}$'
 or coalesce(p_status,'') not in ('CONFIRMED_HARMFUL','RETRACTED')
 or coalesce(p_reason,'') not in ('REVIEWED_ONCHAIN_SELL_RESTRICTION','REVIEWED_ONCHAIN_EXPLOIT')
 or coalesce(lower(p_transaction_hash),'') !~ '^0x[a-f0-9]{64}$'
 or coalesce(length(trim(p_review_reference)),0) not between 8 and 128
 or coalesce(length(trim(p_note)),0) not between 10 and 240 then raise exception 'Reviewed on-chain evidence required'; end if;
 if p_chain='robinhood' then v_creator:=public.alpha_verified_outcome_pons_creator(v_token); end if;
 if v_creator is not null then v_source:='PONS_FACTORY_EVENT';
 else
  select creator into v_creator from public.alpha_deployment_creator_evidence where chain=p_chain and token=v_token and status='VERIFIED';
  if v_creator is not null then v_source:='CHAIN_DEPLOYMENT_RECEIPT'; end if;
 end if;
 insert into public.alpha_reviewed_token_risk(chain,token,status,reason,transaction_hash,review_reference,note,creator,creator_source)
 values(p_chain,v_token,p_status,p_reason,lower(p_transaction_hash),trim(p_review_reference),trim(p_note),v_creator,v_source)
 on conflict(chain,token) do update set status=excluded.status,reason=excluded.reason,transaction_hash=excluded.transaction_hash,
 review_reference=excluded.review_reference,note=excluded.note,creator=excluded.creator,creator_source=excluded.creator_source,reviewed_at=now();
 return p_status;
end $$;
revoke execute on function public.alpha_set_reviewed_token_risk(text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.alpha_set_reviewed_token_risk(text,text,text,text,text,text,text) to service_role;

-- Classification is derived from existing records: no duplicate token histories,
-- polling, JSON snapshots or new per-alert database writes.
create function public.alpha_compact_detail_expiry(p_outcome text,p_creator text,p_creator_source text,p_finalized_at timestamptz,p_reviewed_harmful boolean) returns timestamptz
language sql stable security invoker set search_path='' as $$
 select p_finalized_at+make_interval(hours=>case
 when p_reviewed_harmful is true or (p_outcome in ('FAILED','INCOMPLETE')
  and p_creator ~ '^0x[a-f0-9]{40}$' and p_creator<>'0x0000000000000000000000000000000000000000'
  and p_creator_source in ('PONS_FACTORY_EVENT','CHAIN_DEPLOYMENT_RECEIPT')) then 48 else 168 end);
$$;
revoke execute on function public.alpha_compact_detail_expiry(text,text,text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.alpha_compact_detail_expiry(text,text,text,timestamptz,boolean) to service_role;

create view public.alpha_token_classification with (security_invoker=true) as
with observed as (
 select chain,token,creator,creator_source,outcome,finalized_at assessed_at,
 finalized_at+interval '7 days' detail_expires_at,'TRACKING_DETAIL'::text record_source
 from public.alpha_compact_tracking
 union all
 select w.chain,w.token,w.creator,w.creator_source,'WINNER',w.assessed_at,null,'WINNER_ARCHIVE'
 from public.alpha_successful_tokens w
 where not exists(select 1 from public.alpha_compact_tracking t where t.chain=w.chain and t.token=w.token)
)
select coalesce(o.chain,r.chain) chain,coalesce(o.token,r.token) token,
 case when r.status='CONFIRMED_HARMFUL' then 'CONFIRMED_HARMFUL'
 when o.outcome='WINNER' then 'WINNER'
 when o.outcome='FAILED' then 'FAILED'
 when o.outcome='NEUTRAL' then 'OTHER_OBSERVED'
 when o.outcome='INCOMPLETE' then 'UNVERIFIED_INCOMPLETE'
 when o.record_source is not null then 'TRACKING' else 'UNVERIFIED_INCOMPLETE' end category,
 o.outcome,r.status reviewed_risk_status,r.reason risk_reason,r.transaction_hash risk_transaction_hash,
 r.review_reference,r.note risk_note,r.reviewed_at,
 coalesce(o.creator,r.creator) creator,case when o.creator is not null then o.creator_source else r.creator_source end creator_source,
 o.assessed_at,case when o.record_source='TRACKING_DETAIL' then public.alpha_compact_detail_expiry(o.outcome,o.creator,o.creator_source,o.assessed_at,r.status='CONFIRMED_HARMFUL') end detail_expires_at,
 coalesce(o.record_source,'REVIEWED_RISK_ONLY') record_source
from observed o full join public.alpha_reviewed_token_risk r on r.chain=o.chain and r.token=o.token;
revoke all on public.alpha_token_classification from public,anon,authenticated;
grant select on public.alpha_token_classification to service_role;

create or replace function public.alpha_compact_maintenance(p_excluded jsonb default '[]') returns integer
language plpgsql security invoker set search_path='' set lock_timeout='100ms' as $$
declare n integer; x jsonb;
begin
 if p_excluded is null or jsonb_typeof(p_excluded)<>'array' or jsonb_array_length(p_excluded)>32 then raise exception 'Invalid coverage batch'; end if;
 for x in select * from jsonb_array_elements(p_excluded) loop
  if x->>'chain' in ('solana','robinhood','arc') and length(x->>'feed')<=64 and (x->>'count')::bigint between 1 and 100000 then
   insert into public.alpha_feed_outcome_daily(day,chain,feed,excluded) values((now() at time zone 'UTC')::date,x->>'chain',x->>'feed',(x->>'count')::bigint)
   on conflict(day,chain,feed) do update set excluded=alpha_feed_outcome_daily.excluded+excluded.excluded;
  end if;
 end loop;
 -- Preserve developer risk history when identity proof arrives after review.
 -- Only compact verified identity fields are added; review evidence is unchanged.
 with pending as (
  select r.chain,r.token from public.alpha_reviewed_token_risk r where r.creator is null
  and ((r.chain='robinhood' and public.alpha_verified_outcome_pons_creator(r.token) is not null)
   or exists(select 1 from public.alpha_deployment_creator_evidence e where e.chain=r.chain and e.token=r.token and e.status='VERIFIED'))
  order by r.reviewed_at,r.chain,r.token for update skip locked limit 25
 ), proof as (
  select p.chain,p.token,
   coalesce(case when p.chain='robinhood' then public.alpha_verified_outcome_pons_creator(p.token) end,e.creator) creator,
   case when p.chain='robinhood' and public.alpha_verified_outcome_pons_creator(p.token) is not null then 'PONS_FACTORY_EVENT' else 'CHAIN_DEPLOYMENT_RECEIPT' end source
  from pending p left join public.alpha_deployment_creator_evidence e on e.chain=p.chain and e.token=p.token and e.status='VERIFIED'
 ) update public.alpha_reviewed_token_risk r set creator=p.creator,creator_source=p.source from proof p
 where r.chain=p.chain and r.token=p.token and r.creator is null and p.creator is not null;
 -- Known-developer failures/incompletes and reviewed harmful details expire at
 -- 48h; others retain seven days for checkpoint review and late developer proof.
 -- Delete only 25 expired details per existing five-minute tick.
 -- Preserve any winner lacking its archive and any readily recoverable identity.
 with expired as (
  select t.chain,t.token from public.alpha_compact_tracking t
  where t.finalized_at<now()-interval '48 hours'
  and public.alpha_compact_detail_expiry(t.outcome,t.creator,t.creator_source,t.finalized_at,
   exists(select 1 from public.alpha_reviewed_token_risk r where r.chain=t.chain and r.token=t.token and r.status='CONFIRMED_HARMFUL'))<now()
  and (t.outcome<>'WINNER' or exists(select 1 from public.alpha_successful_tokens w where w.chain=t.chain and w.token=t.token and w.baseline_price=t.baseline_price and w.price_unit=t.price_unit and w.samples=t.samples))
  and not (t.creator is null and (
   (t.chain='robinhood' and public.alpha_verified_outcome_pons_creator(t.token) is not null)
   or exists(select 1 from public.alpha_deployment_creator_evidence e where e.chain=t.chain and e.token=t.token and e.status='VERIFIED')))
  order by t.finalized_at,t.chain,t.token for update of t skip locked limit 25
 ) delete from public.alpha_compact_tracking t using expired e where t.chain=e.chain and t.token=e.token;
 get diagnostics n=row_count;
 -- Retain compact proof for winners and reviewed risk; prune orphan losing
 -- evidence in small batches. Never touch the census or developer aggregates.
 with expired as (
  select e.chain,e.token from public.alpha_deployment_creator_evidence e
  where e.checked_at<now()-interval '7 days'
  and not exists(select 1 from public.alpha_compact_tracking t where t.chain=e.chain and t.token=e.token)
  and not exists(select 1 from public.alpha_successful_tokens w where w.chain=e.chain and w.token=e.token)
  and not exists(select 1 from public.alpha_reviewed_token_risk r where r.chain=e.chain and r.token=e.token)
  order by e.checked_at,e.chain,e.token for update of e skip locked limit 25
 ) delete from public.alpha_deployment_creator_evidence e using expired x where e.chain=x.chain and e.token=x.token;
 return n;
end $$;

-- The verifier also had an orphan cleanup; give it identical bounded retention
-- so that path cannot discard proof referenced by a reviewed harmful record.
create or replace function public.alpha_claim_creator_verification() returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='100ms' as $$
declare x record; v_lease uuid:=gen_random_uuid();
begin
 if not pg_try_advisory_xact_lock(84020261017::bigint) then return null; end if;
 if exists(select 1 from public.alpha_deployment_creator_evidence where checked_at>now()-interval '10 minutes') then return null; end if;
 -- Expiry now belongs to the existing bounded maintenance function above.
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
