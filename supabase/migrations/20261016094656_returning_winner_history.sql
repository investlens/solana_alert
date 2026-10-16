-- One bounded, read-only snapshot shared across all newly observed launches.
create index if not exists alpha_successful_creator_history on public.alpha_successful_tokens(chain,creator,assessed_at) where creator is not null;
create function public.alpha_returning_winner_history() returns jsonb
language sql stable security invoker set search_path='' as $$
 with creators as (
  select s.* from public.alpha_creator_outcome_summary s
  where s.chain='robinhood' and s.winners>0 and s.creator ~ '^0x[a-f0-9]{40}$'
  and s.creator<>'0x0000000000000000000000000000000000000000'
  and s.assessed_sessions=s.winners+s.failed+s.neutral+s.incomplete
  and least(s.winners,s.failed,s.neutral,s.incomplete)>=0
  and not exists(select 1 from public.alpha_reviewed_token_risk r where r.chain=s.chain and r.creator=s.creator and r.status='CONFIRMED_HARMFUL')
  and not exists(select 1 from public.alpha_successful_tokens w join public.alpha_reviewed_token_risk r on r.chain=w.chain and r.token=w.token and r.status='CONFIRMED_HARMFUL'
   where w.chain=s.chain and w.creator=s.creator and w.creator_source in ('PONS_FACTORY_EVENT','CHAIN_DEPLOYMENT_RECEIPT'))
  order by s.last_assessed_at desc,s.creator limit 1000
 ), valid_winners as (
  select w.chain,w.token,w.creator,w.creator_source,w.price_unit,w.baseline_price,w.final_roi,w.sampled_low_roi,w.samples,w.assessed_at
  from public.alpha_successful_tokens w join creators c on c.chain=w.chain and c.creator=w.creator
  where w.creator_source in ('PONS_FACTORY_EVENT','CHAIN_DEPLOYMENT_RECEIPT')
  and w.price_unit in ('USD','ETH_RESERVE_RATIO') and w.baseline_price>0 and w.baseline_price<'Infinity'::float8
  and w.final_roi>=25 and w.final_roi<'Infinity'::float8 and w.sampled_low_roi>=-30 and w.sampled_low_roi<=0
  and w.assessed_at<=now()
  and case when jsonb_typeof(w.samples)='array' then jsonb_array_length(w.samples)=3 else false end
  and not exists(select 1 from public.alpha_reviewed_token_risk r where r.chain=w.chain and r.token=w.token and r.status='CONFIRMED_HARMFUL')
 ), histories as (
  select c.creator,c.assessed_sessions,c.winners,c.failed,c.neutral,c.incomplete,c.last_assessed_at,
   (select jsonb_agg(to_jsonb(p) order by p.assessed_at desc,p.token) from (
    (select * from valid_winners w where w.creator=c.creator order by w.assessed_at asc,w.token limit 1)
    union
    (select * from valid_winners w where w.creator=c.creator order by w.assessed_at desc,w.token limit 2)
   ) p) prior_winners
  from creators c
 ) select jsonb_build_object('as_of',now(),'capped',(select count(*)>=1000 from creators),
  'developers',coalesce((select jsonb_agg(to_jsonb(h) order by h.creator) from histories h where h.prior_winners is not null),'[]'::jsonb));
$$;
revoke execute on function public.alpha_returning_winner_history() from public,anon,authenticated;
grant execute on function public.alpha_returning_winner_history() to service_role;

-- Required by the preference table's registry foreign key. No existing setting
-- is changed, and the new discovery feed has no execution/trading permission.
insert into public.strategy_registry(strategy_key,name,description,chain,category,enabled,user_visible,default_user_enabled,execution_mode,default_action,priority)
values('RH_RETURNING_WINNER_DEV','Returning Winner Developer','Fresh verified PONS launch with an independently measured prior developer winner.','robinhood','discovery',true,true,true,'manual','WATCH',70)
on conflict(strategy_key) do nothing;

-- Batch only this new feed's sparse preferences. Older workers may overwrite
-- the legacy shared preference cache without knowing this newly added key.
create function public.alpha_returning_winner_recipients(p_users text[]) returns text[]
language plpgsql stable security invoker set search_path='' as $$
begin
 if p_users is null or cardinality(p_users)>5000 then raise exception 'Invalid recipient batch'; end if;
 if not exists(select 1 from public.strategy_registry where strategy_key='RH_RETURNING_WINNER_DEV' and enabled=true) then return '{}'::text[]; end if;
 return array(select u.id from unnest(p_users) with ordinality u(id,n)
  where not exists(select 1 from public.user_strategy_preferences p where p.strategy_key='RH_RETURNING_WINNER_DEV' and p.telegram_id::text=u.id and p.enabled=false)
  order by u.n);
end $$;
revoke execute on function public.alpha_returning_winner_recipients(text[]) from public,anon,authenticated;
grant execute on function public.alpha_returning_winner_recipients(text[]) to service_role;
