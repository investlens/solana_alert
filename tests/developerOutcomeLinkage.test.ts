import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createDeveloperOutcomeReconciler } from '../src/services/developerOutcomeLinkage.js';
import { resetDatabaseGovernorForTests } from '../src/services/databaseLoadGovernor.js';

const factory='0x0c37a24f5d23a486fa692d1500881d698b1f77a4';
const token='0x'+'1'.repeat(40), creator='0x'+'2'.repeat(40), other='0x'+'3'.repeat(40);
const migration=(name:string)=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');

test('developer attribution executes real PostgreSQL without changing measured outcomes', async t=>{
 const db=new PGlite();
 const scalar=async(sql:string,params:any[]=[])=>Object.values((await db.query(sql,params)).rows[0] as any)[0];
 await db.exec('create role anon; create role authenticated; create role service_role;');
 for(const file of ['20260903170000_pons_developer_launch_census.sql','20261002185816_alphaos_compact_alert_outcomes.sql',
  '20261002190839_compact_outcome_sample_validation.sql','20261016070914_repair_developer_outcome_linkage.sql']) await db.exec(migration(file));
 const proof=async(wallet=creator,chain='robinhood',f=factory,hash='a')=>db.query(`insert into public.pons_launches(chain,protocol,protocol_version,factory_address,token_address,deployer_address,block_number,block_timestamp,transaction_hash,log_index) values($1,'pons','v2',$2,$3,$4,1,now(),$5,0)`,[chain,f,token,wallet,'0x'+hash.repeat(64)]);
 const register=async()=>scalar(`select public.alpha_register_compact_alert('robinhood',$1,'BOOST',1,100,100,$1,'USD')`,[token]);
 const link=async()=>scalar('select public.alpha_link_compact_pons_creator($1)',[token]);
 const sessions=async()=>Number(await scalar('select coalesce(sum(assessed_sessions),0) from public.alpha_creator_outcome_summary'));
 const winner=async()=>db.query(`insert into public.alpha_successful_tokens(chain,token,feed,price_unit,baseline_price,final_roi,sampled_peak_roi,sampled_low_roi,samples) values('robinhood',$1,'BOOST','USD',1,50,60,-5,'[]')`,[token]);
 const finish=async()=>{
  await db.query(`update public.alpha_compact_tracking set checkpoint=2,samples='[{"status":"MEASURED","price":1.1},{"status":"MEASURED","price":1.2}]',lease='00000000-0000-0000-0000-000000000001' where token=$1`,[token]);
  return scalar(`select public.alpha_finish_compact_check('robinhood',$1,'00000000-0000-0000-0000-000000000001','{"status":"MEASURED","price":1.5,"mc":null,"liquidity":null,"at":"2026-10-16T00:00:00Z"}')`,[token]);
 };
 const scenario=async(name:string,fn:()=>Promise<void>)=>t.test(name,async()=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}});
 try {
  await scenario('no proof, wrong chain, unknown factory, zero developer and contradictory proofs remain unknown',async()=>{
   await register(); assert.equal(await link(),'UNVERIFIED');
   await proof(creator,'arc'); assert.equal(await link(),'UNVERIFIED');
   await proof(creator,'robinhood',other); assert.equal(await link(),'UNVERIFIED');
   await proof('0x'+'0'.repeat(40),'robinhood',factory,'b'); assert.equal(await link(),'UNVERIFIED');
   await proof(); await proof(other,'robinhood',factory,'c'); assert.equal(await link(),'UNVERIFIED');
   assert.equal(await sessions(),0);
  });
  await scenario('late proof repairs an active REUSED row; finalization counts once',async()=>{
   await register(); assert.equal(await register(),'REUSED'); await proof();
   assert.equal(await link(),'LINKED_ACTIVE'); assert.equal(await sessions(),0);
   assert.equal(await link(),'ALREADY_LINKED'); assert.equal(await finish(),'WINNER');
   assert.equal(await sessions(),1); assert.equal(await link(),'ALREADY_LINKED'); assert.equal(await sessions(),1);
   assert.equal(await scalar('select creator from public.alpha_successful_tokens'),creator);
  });
  await scenario('finalization before repair counts tracking/winner pair only once, preserving all market evidence',async()=>{
   await register(); await finish(); await proof();
   const snapshot=async()=>scalar(`select jsonb_build_object('tracking',(select to_jsonb(t)-'creator'-'creator_source' from public.alpha_compact_tracking t),'winner',(select to_jsonb(w)-'creator'-'creator_source' from public.alpha_successful_tokens w),'feeds',(select jsonb_agg(f) from public.alpha_feed_outcome_daily f))`);
   const before=await snapshot();
   assert.equal(await link(),'LINKED_COMPLETED'); assert.equal(await sessions(),1);
   assert.equal(await link(),'ALREADY_LINKED'); assert.equal(await sessions(),1); assert.deepEqual(await snapshot(),before);
  });
  await scenario('retained winner after detail retention is counted once and KNOWN_WINNER is repairable',async()=>{
   await winner(); assert.equal(await register(),'KNOWN_WINNER'); await proof();
   assert.equal(await link(),'LINKED_COMPLETED'); assert.equal(await sessions(),1);
   assert.equal(await link(),'ALREADY_LINKED'); assert.equal(await sessions(),1);
  });
  for(const outcome of ['FAILED','NEUTRAL','INCOMPLETE']) await scenario(outcome+' is attributed without reclassification',async()=>{
   await register(); await db.query('update public.alpha_compact_tracking set finalized_at=now(),outcome=$1',[outcome]); await proof();
   assert.equal(await link(),'LINKED_COMPLETED'); assert.equal(await sessions(),1);
   assert.equal(Number(await scalar('select '+outcome.toLowerCase()+' from public.alpha_creator_outcome_summary')),1);
  });
  await scenario('existing different identity is never overwritten',async()=>{
   await register(); await proof(); await db.query("update public.alpha_compact_tracking set creator=$1,creator_source='CHAIN_DEPLOYMENT_RECEIPT'",[other]);
   assert.equal(await link(),'CONFLICT'); assert.equal(await sessions(),0);
   assert.equal(await scalar('select creator from public.alpha_compact_tracking'),other);
  });
  await scenario('known completed identity can repair its winner copy without incrementing historical counters',async()=>{
   await register(); await proof(); await link(); await finish();
   await db.exec('update public.alpha_successful_tokens set creator=null,creator_source=null');
   assert.equal(await link(),'LINKED_WINNER_COPY'); assert.equal(await sessions(),1);
  });
  await scenario('bounded batch is idempotent and invalid batch size is rejected',async()=>{
   await register(); await proof();
   assert.deepEqual(await scalar('select public.alpha_reconcile_compact_creators(1)'),{LINKED_ACTIVE:1});
   assert.deepEqual(await scalar('select public.alpha_reconcile_compact_creators(25)'),{});
   await assert.rejects(()=>scalar('select public.alpha_reconcile_compact_creators(26)'),/Invalid attribution batch/);
  });
  await scenario('anonymous and authenticated clients cannot invoke attribution',async()=>{
   for(const role of ['anon','authenticated']) assert.equal(await scalar("select has_function_privilege($1,'public.alpha_reconcile_compact_creators(integer)','execute')",[role]),false);
   assert.equal(await scalar("select has_function_privilege('service_role','public.alpha_reconcile_compact_creators(integer)','execute')"),true);
  });
 } finally {await db.close();}
});

test('background attribution is bounded, non-overlapping and retries after failure without throwing',async()=>{
 resetDatabaseGovernorForTests(); let now=1, calls=0; let release!:()=>void;
 const run=createDeveloperOutcomeReconciler({now:()=>now,reconcile:async()=>{calls++;await new Promise<void>(r=>release=r);return {};}});
 const first=run(); await run(); assert.equal(calls,1); release(); await first;
 await run(); assert.equal(calls,1); now+=5*60000;
 const second=run(); assert.equal(calls,2); release(); await second;
 const failing=createDeveloperOutcomeReconciler({now:()=>now,reconcile:async()=>{throw new Error('provider unavailable');}});
 await assert.doesNotReject(failing);
});
