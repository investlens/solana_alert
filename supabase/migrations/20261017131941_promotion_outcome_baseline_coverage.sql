-- One compact evidence record per accepted Robinhood promotion, not per user.
-- Sampling still uses the existing token tracker and its original budgets.
create table public.alpha_promotion_baselines (
 event_identity text primary key check(length(event_identity) between 1 and 240),
 chain text not null check(chain='robinhood'),token text not null check(token ~ '^0x[a-f0-9]{40}$'),
 feed text not null check(feed in ('BOOST','DEX_PAID')),
 captured_at timestamptz not null,first_accepted_at timestamptz not null,
 reason text not null check(reason in ('VERIFIED_EXACT_PAIR','PRE_BOND_NO_COMPARABLE_DEX_BASELINE','NO_RENDERED_STATS','UNVERIFIED_MARKET_SOURCE','EXACT_PAIR_UNAVAILABLE','PRICE_UNAVAILABLE','CHECKED_POOL_MISMATCH')),
 admission text not null check(admission in ('NO_ACCEPTANCE','DISABLED','UNSUPPORTED_CHAIN','LOCAL_REUSED','LOCAL_BUSY','COOLDOWN','RATE_LIMIT','NO_BASELINE','REGISTERED','REUSED','KNOWN_WINNER','CAPACITY','INVALID','DATABASE_UNAVAILABLE','UNEXPECTED')),
 price double precision,pair_id text,price_unit text,market_cap double precision,liquidity double precision,
 quote_source text check(length(quote_source)<=120),
 check(isfinite(captured_at) and isfinite(first_accepted_at) and first_accepted_at>=captured_at),
 check((reason='VERIFIED_EXACT_PAIR' and price is not null and price>0 and price<'Infinity'::float8
   and pair_id is not null and pair_id ~ '^0x([a-f0-9]{40}|[a-f0-9]{64})$' and pair_id<>token and pair_id!~'^0x0+$' and price_unit is not null and price_unit='USD'
   and quote_source is not null and position('DEXScreener' in quote_source)>0)
  or (reason<>'VERIFIED_EXACT_PAIR' and price is null and pair_id is null and price_unit is null)),
 check(market_cap is null or (market_cap>0 and market_cap<'Infinity'::float8)),
 check(liquidity is null or (liquidity>0 and liquidity<'Infinity'::float8))
);
create index alpha_promotion_baselines_accepted on public.alpha_promotion_baselines(first_accepted_at);
create index alpha_promotion_baselines_token on public.alpha_promotion_baselines(chain,token,first_accepted_at);
alter table public.alpha_promotion_baselines enable row level security;
revoke all on public.alpha_promotion_baselines from public,anon,authenticated;
grant select,insert,update,delete on public.alpha_promotion_baselines to service_role;

create function public.alpha_record_promotion_baseline(p_baseline jsonb) returns text
language plpgsql security invoker set search_path='' set statement_timeout='2s' as $$
declare r public.alpha_promotion_baselines; n integer; prior_at timestamptz;
begin
 if jsonb_typeof(p_baseline) is distinct from 'object' or pg_column_size(p_baseline)>4096
  or exists(select 1 from jsonb_object_keys(p_baseline) k where k not in ('event_identity','chain','token','feed','captured_at','first_accepted_at','reason','admission','price','pair_id','price_unit','market_cap','liquidity','quote_source')) then raise exception 'Invalid baseline evidence';end if;
 select * into r from jsonb_populate_record(null::public.alpha_promotion_baselines,p_baseline);
 if r.event_identity is null or r.chain is null or r.token is null or r.feed is null or r.reason is null or r.admission is null
  or r.captured_at is null or r.first_accepted_at is null or not isfinite(r.captured_at) or not isfinite(r.first_accepted_at)
  or r.captured_at<now()-interval '7 days' or r.first_accepted_at>now()+interval '30 seconds' or r.captured_at>r.first_accepted_at then raise exception 'Invalid baseline timing';end if;
 perform pg_advisory_xact_lock(84020261017::bigint);
 -- Indexed, bounded retention; no new cron/worker or unbounded history.
 delete from public.alpha_promotion_baselines where event_identity in
  (select event_identity from public.alpha_promotion_baselines where first_accepted_at<now()-interval '7 days' order by first_accepted_at limit 100);
 select first_accepted_at into prior_at from public.alpha_promotion_baselines where event_identity=r.event_identity;
 if prior_at is not null then
  if exists(select 1 from public.alpha_promotion_baselines b where b.event_identity=r.event_identity and (b.chain<>r.chain or b.token<>r.token or b.feed<>r.feed)) then raise exception 'Conflicting event identity';end if;
  if r.first_accepted_at>=prior_at then return 'EXISTS';end if;
 elsif (select count(*) from public.alpha_promotion_baselines)>=5000 then return 'CAPACITY';
 end if;
 insert into public.alpha_promotion_baselines select (r).*
 on conflict(event_identity) do update set captured_at=excluded.captured_at,first_accepted_at=excluded.first_accepted_at,
  reason=excluded.reason,admission=excluded.admission,price=excluded.price,pair_id=excluded.pair_id,price_unit=excluded.price_unit,
  market_cap=excluded.market_cap,liquidity=excluded.liquidity,quote_source=excluded.quote_source
 where excluded.first_accepted_at<alpha_promotion_baselines.first_accepted_at;
 return case when prior_at is null then 'RECORDED' else 'EARLIER_ACCEPTANCE_RECORDED' end;
end $$;
revoke execute on function public.alpha_record_promotion_baseline(jsonb) from public,anon,authenticated;
grant execute on function public.alpha_record_promotion_baseline(jsonb) to service_role;
