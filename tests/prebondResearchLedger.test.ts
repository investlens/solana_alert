import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';
const migration=readFileSync(new URL('../supabase/migrations/20261018152600_prebond_promotion_research.sql',import.meta.url),'utf8');
const token='0x'+'1'.repeat(40),curve='0x'+'2'.repeat(40),hash='0x'+'a'.repeat(64);
test('isolated research ledger validates provenance, leases, sampling windows, caps and grants',async()=>{
 const db=new PGlite();try{
  await db.exec("create role anon;create role authenticated;create role service_role;create table public.pons_launches(token_address text,curve_address text,chain text,protocol text,protocol_version text);create table public.alpha_promotion_baselines(event_identity text,token text,reason text,first_accepted_at timestamptz);");
  await db.exec(migration);
  await db.query("insert into pons_launches values($1,$2,'robinhood','pons','v2-current');",[token,curve]);
  await db.query("insert into alpha_promotion_baselines values('event',$1,'PRE_BOND_NO_COMPARABLE_DEX_BASELINE',now()-interval '2 seconds')",[token]);
  const p={event_identity:'event',token,curve,price:1,at:new Date(Date.now()-1000).toISOString(),block:'100',block_hash:hash};
  const register=async(v:any)=>(await db.query<{s:string}>('select alpha_register_prebond_research($1::jsonb) as s',[JSON.stringify(v)])).rows[0].s;
  assert.equal(await register({...p,event_identity:'unaccepted'}),'NO_ACCEPTED_BASELINE');
  assert.equal(await register({...p,curve:token.replace(/1/g,'3')}),'UNVERIFIED_CURVE');
  for(const patch of [{extra:1},{price:0},{block:'oops'},{block_hash:'bad'},{at:new Date(Date.now()+60000).toISOString()}])await assert.rejects(register({...p,...patch}));
  assert.equal(await register(p),'REGISTERED');assert.equal(await register(p),'EXISTS');
  const other='0x'+'3'.repeat(40);
  await db.query("insert into pons_launches values($1,$2,'robinhood','pons','v2-current')",[other,curve]);
  await db.query("insert into alpha_promotion_baselines values('other',$1,'PRE_BOND_NO_COMPARABLE_DEX_BASELINE',now()-interval '2 seconds')",[other]);
  assert.equal(await register({...p,event_identity:'other',token:other}),'RATE_LIMIT');
  await db.exec("update alpha_prebond_research set first_accepted_at=now()-interval '16 minutes',started_at=now()-interval '15 minutes',due_at=now()-interval '1 second'");
  const rows=(await db.query<any>('select * from alpha_claim_prebond_research()')).rows;assert.equal(rows.length,1);
  assert.equal((await db.query('select * from alpha_claim_prebond_research()')).rows.length,0);
  const finish=async(lease:string,s:any)=>(await db.query<{s:string}>('select alpha_finish_prebond_research($1,$2::uuid,$3::jsonb) as s',['event',lease,JSON.stringify(s)])).rows[0].s;
  const sample={status:'MEASURED',price:2,at:new Date().toISOString(),block:'101',block_hash:hash};
  await assert.rejects(finish(rows[0].lease,{...sample,block:'100'}));
  await assert.rejects(finish(rows[0].lease,{...sample,price:null}));
  assert.equal(await finish(rows[0].lease,sample),'CHECKPOINT');
  assert.equal(await finish(rows[0].lease,sample),'STALE');
  // Advance the stored schedule to simulate a later checkpoint without waiting.
  await db.exec("update alpha_prebond_research set last_claim_at=now()-interval '2 minutes',first_accepted_at=now()-interval '2 hours',started_at=now()-interval '1 hour',due_at=now()-interval '1 second'");
  const next=(await db.query<any>('select * from alpha_claim_prebond_research()')).rows[0];
  assert.equal(await finish(next.lease,{...sample,status:'GRADUATED',price:null,block:'102',at:new Date().toISOString(),reason:'VENUE_TRANSITION'}),'VENUE_TRANSITION');
  const result=(await db.query<any>('select outcome,sampled_change_pct from alpha_prebond_research')).rows[0];
  assert.deepEqual(result,{outcome:'VENUE_TRANSITION',sampled_change_pct:null});
  // No shared winner tables exist: any accidental winner/developer write fails.
  const grants=(await db.query("select has_table_privilege('anon','alpha_prebond_research','select') as readable,has_function_privilege('authenticated','alpha_claim_prebond_research()','execute') as callable,(select relrowsecurity from pg_class where oid='alpha_prebond_research'::regclass) as rls")).rows[0];
  assert.deepEqual(grants,{readable:false,callable:false,rls:true});
  await db.exec("truncate alpha_prebond_research;insert into alpha_prebond_research(event_identity,token,curve,baseline_price,baseline_block,baseline_block_hash,first_accepted_at,started_at,due_at) select 'cap:'||n,'"+token+"','"+curve+"',1,'100','"+hash+"',now()-interval '2 minutes',now()-interval '1 minute',now()+interval '14 minutes' from generate_series(1,10)n");
  await db.exec("update alpha_prebond_research set finalized_at=now(),outcome='INCOMPLETE' where event_identity='cap:1'");
  assert.equal(await register(p),'REUSED');
  await db.exec("update alpha_prebond_research set token='0x'||repeat('3',40),finalized_at=null,outcome=null");
  assert.equal(await register(p),'CAPACITY');
  await db.exec("truncate alpha_prebond_research");
  assert.equal(await register(p),'REGISTERED');
  await db.exec("update alpha_prebond_research set first_accepted_at=now()-interval '7 hours',started_at=now()-interval '6 hours',due_at=now()-interval '1 second',checkpoint=2,samples=jsonb_build_array(jsonb_build_object('status','MEASURED','price',1.1,'at',now()-interval '5 hours'),jsonb_build_object('status','MEASURED','price',1.2,'at',now()-interval '4 hours'))");
  const final=(await db.query<any>('select * from alpha_claim_prebond_research()')).rows[0];
  assert.equal(await finish(final.lease,{...sample,at:new Date().toISOString()}),'COMPLETE');
  assert.equal((await db.query<any>('select sampled_change_pct from alpha_prebond_research')).rows[0].sampled_change_pct,100);
  // A current quote must never be substituted for a missed historical slot.
  await db.exec("update alpha_prebond_research set finalized_at=null,outcome=null,checkpoint=0,samples='[]',due_at=now()-interval '6 minutes',last_claim_at=now()-interval '2 minutes'");
  const missed=(await db.query<any>('select * from alpha_claim_prebond_research()')).rows[0];
  assert.equal(await finish(missed.lease,{...sample,at:new Date().toISOString()}),'CHECKPOINT');
  assert.equal((await db.query<any>("select samples->0->>'status' as status,samples->0->>'reason' as reason from alpha_prebond_research")).rows[0].reason,'MISSED_CHECKPOINT_WINDOW');
  await db.exec("update alpha_prebond_research set last_claim_at=now()-interval '2 minutes'");
  const lateTransition=(await db.query<any>('select * from alpha_claim_prebond_research()')).rows[0];
  assert.equal(await finish(lateTransition.lease,{...sample,status:'GRADUATED',price:null,block:'102',at:new Date().toISOString()}),'VENUE_TRANSITION','a currently observed graduation ends research even if a price checkpoint was missed');
  await db.exec("truncate alpha_prebond_research;insert into alpha_prebond_research(event_identity,token,curve,baseline_price,baseline_block,baseline_block_hash,first_accepted_at,started_at,due_at,finalized_at,outcome) select 'full:'||n,'"+token+"','"+curve+"',1,'100','"+hash+"',now()-interval '2 minutes',now()-interval '1 minute',now(),now(),'INCOMPLETE' from generate_series(1,200)n");
  assert.equal(await register(p),'CAPACITY');
  await db.exec("truncate alpha_prebond_research;insert into alpha_prebond_research(event_identity,token,curve,baseline_price,baseline_block,baseline_block_hash,first_accepted_at,started_at,due_at,finalized_at,outcome) select 'expired:'||n,'"+token+"','"+curve+"',1,'100','"+hash+"',now()-interval '9 days',now()-interval '8 days',now()-interval '7 days',now()-interval '7 days','INCOMPLETE' from generate_series(1,11)n");
  await db.query('select * from alpha_claim_prebond_research()');
  assert.equal((await db.query<{n:number}>('select count(*)::int as n from alpha_prebond_research')).rows[0].n,1,'bounded cleanup removes at most ten rows');
 }finally{await db.close();}
});
