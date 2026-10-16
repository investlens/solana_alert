create or replace function public.alpha_winner_sample_valid(samples jsonb,baseline double precision,roi double precision,low_roi double precision,assessed timestamptz) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare i integer; p double precision; r double precision; last_r double precision; low_r double precision:=0; t timestamptz; previous_t timestamptz;
begin
 if jsonb_typeof(samples) is distinct from 'array' or jsonb_array_length(samples)<>3 or baseline is null or baseline<=0 or baseline>='Infinity'::float8 or assessed is null then return false; end if;
 for i in 0..2 loop
  if samples->i->>'status' is distinct from 'MEASURED' or jsonb_typeof(samples->i->'price') is distinct from 'number' or jsonb_typeof(samples->i->'at') is distinct from 'string' then return false;end if;
  p:=(samples->i->>'price')::double precision;t:=(samples->i->>'at')::timestamptz;
  if p is null or p<=0 or p>='Infinity'::float8 or t is null or not isfinite(t) or (previous_t is not null and t<=previous_t) or t>assessed+interval '30 seconds' then return false;end if;
  r:=(p/baseline-1)*100;low_r:=least(low_r,r);last_r:=r;previous_t:=t;
 end loop;
 return roi is not null and low_roi is not null and last_r>=25 and low_r>=-30
 and abs(last_r-roi)<1e-6*greatest(1,abs(last_r)) and abs(low_r-low_roi)<1e-6*greatest(1,abs(low_r));
exception when others then return false;
end $$;
revoke execute on function public.alpha_winner_sample_valid(jsonb,double precision,double precision,double precision,timestamptz) from public,anon,authenticated;
grant execute on function public.alpha_winner_sample_valid(jsonb,double precision,double precision,double precision,timestamptz) to service_role;
