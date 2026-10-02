create or replace function public.alpha_finish_compact_check(p_chain text,p_token text,p_lease uuid,p_sample jsonb,p_retry boolean default false) returns text
language plpgsql security invoker set search_path='' as $$
declare r public.alpha_compact_tracking; v_samples jsonb; v_outcome text; v_roi float8; v_peak float8; v_low float8; v_complete boolean; v_checkpoint int;
begin
 select * into r from public.alpha_compact_tracking where chain=p_chain and token=p_token and lease=p_lease and finalized_at is null for update;
 if not found then return 'STALE'; end if;
 if p_retry and not r.retried and now()<r.started_at+make_interval(mins=>case r.checkpoint when 0 then 15 when 1 then 60 else 360 end)+interval '5 minutes' then
  update public.alpha_compact_tracking set retried=true,due_at=now()+interval '1 minute',lease=null,lease_until=null where chain=p_chain and token=p_token;
  return 'RETRY';
 end if;
 if p_sample is null or jsonb_typeof(p_sample)<>'object' or pg_column_size(p_sample)>1024 or coalesce(p_sample->>'status','') not in ('MEASURED','UNAVAILABLE')
 or exists(select 1 from jsonb_object_keys(p_sample) k where k not in ('status','price','mc','liquidity','at','reason')) then raise exception 'Invalid compact sample'; end if;
 if p_sample->>'status'='MEASURED' and ((p_sample->>'price') is null or (p_sample->>'price')::float8<=0 or (p_sample->>'price')::float8>='Infinity'::float8) then raise exception 'Invalid measured price'; end if;
 if p_sample->>'status'='UNAVAILABLE' and p_sample->>'price' is not null then raise exception 'Unavailable price must be null'; end if;
 v_samples:=r.samples||jsonb_build_array(p_sample); v_checkpoint:=r.checkpoint+1;
 if v_checkpoint<3 then
  update public.alpha_compact_tracking set samples=v_samples,checkpoint=v_checkpoint,retried=false,due_at=r.started_at+make_interval(mins=>case v_checkpoint when 1 then 60 else 360 end),lease=null,lease_until=null where chain=p_chain and token=p_token;
  return 'CHECKPOINT';
 end if;
 select bool_and(coalesce(s->>'status'='MEASURED' and (s->>'price')::float8>0,false)), greatest(0,max(((s->>'price')::float8/r.baseline_price-1)*100)),least(0,min(((s->>'price')::float8/r.baseline_price-1)*100)) into v_complete,v_peak,v_low from jsonb_array_elements(v_samples) s;
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

