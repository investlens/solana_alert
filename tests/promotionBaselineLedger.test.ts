import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';
import {capturePromotionOutcomeBaseline} from '../src/services/promotionOutcomeBaseline.js';
test('PostgreSQL promotion ledger validates evidence, isolates events, preserves earliest acceptance and bounds retention',async()=>{
 const db=new PGlite();try{
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(readFileSync(new URL('../supabase/migrations/20261017131941_promotion_outcome_baseline_coverage.sql',import.meta.url),'utf8'));
 const now=Date.now()-60000,token='0x'+'1'.repeat(40),pair='0x'+'2'.repeat(64);
 const b={...capturePromotionOutcomeBaseline({eventIdentity:'paid:1',token,feed:'DEX_PAID',now,stats:{source:'DEXScreener',price:1,chartUrl:'https://dexscreener.com/robinhood/'+pair}}),first_accepted_at:new Date(now+1000).toISOString(),admission:'REGISTERED'};
 const save=async(value:any)=>(await db.query('select public.alpha_record_promotion_baseline($1::jsonb) as result',[JSON.stringify(value)])).rows[0] as any;
 assert.equal((await save(b)).result,'RECORDED');
 assert.equal((await save({...b,price:999,first_accepted_at:new Date(now+2000).toISOString()})).result,'EXISTS');
 assert.equal((await save({...b,price:2,captured_at:new Date(now-1000).toISOString(),first_accepted_at:new Date(now+500).toISOString()})).result,'EARLIER_ACCEPTANCE_RECORDED');
 assert.equal((await db.query<{price:number}>('select price from public.alpha_promotion_baselines')).rows[0].price,2);
 assert.equal((await save({...b,event_identity:'paid:2',price:3,admission:'REUSED'})).result,'RECORDED');
 assert.equal((await db.query<{n:number}>('select count(*)::int as n from public.alpha_promotion_baselines')).rows[0].n,2);
 for(const patch of [{price:-1},{price_unit:null},{price_unit:'ETH_RESERVE_RATIO'},{pair_id:token},{extra:'payload'},{chain:'arc'},{quote_source:'PONS unconfirmed'},{captured_at:new Date(now+2000).toISOString()},{token:'bad'}])await assert.rejects(save({...b,event_identity:'invalid',...patch}));
 await assert.rejects(save({...b,token:'0x'+'3'.repeat(40)}),/Conflicting/);
 const missing={...b,event_identity:'missing',reason:'NO_RENDERED_STATS',price:null,pair_id:null,price_unit:null,quote_source:null,admission:'NO_BASELINE'};
 assert.equal((await save(missing)).result,'RECORDED');
 const grants=(await db.query("select has_function_privilege('anon','public.alpha_record_promotion_baseline(jsonb)','execute') as anon,has_table_privilege('authenticated','public.alpha_promotion_baselines','select') as readable,(select relrowsecurity from pg_class where oid='public.alpha_promotion_baselines'::regclass) as rls")).rows[0];
 assert.deepEqual(grants,{anon:false,readable:false,rls:true});
 await db.exec("truncate public.alpha_promotion_baselines;insert into public.alpha_promotion_baselines(event_identity,chain,token,feed,captured_at,first_accepted_at,reason,admission) select 'expired:'||n,'robinhood','"+token+"','BOOST',now()-interval '8 days',now()-interval '8 days','NO_RENDERED_STATS','NO_BASELINE' from generate_series(1,101)n;");
 await save(b);assert.equal((await db.query<{n:number}>('select count(*)::int as n from public.alpha_promotion_baselines')).rows[0].n,2,'delete at most100 old rows per admission');
 await db.exec("truncate public.alpha_promotion_baselines;insert into public.alpha_promotion_baselines(event_identity,chain,token,feed,captured_at,first_accepted_at,reason,admission) select 'full:'||n,'robinhood','"+token+"','BOOST',now()-interval '1 minute',now(),'NO_RENDERED_STATS','NO_BASELINE' from generate_series(1,5000)n;");
 assert.equal((await save({...b,event_identity:'over-capacity'})).result,'CAPACITY');
 }finally{await db.close();}
});
