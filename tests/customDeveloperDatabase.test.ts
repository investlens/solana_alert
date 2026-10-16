import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';

test('deployment evidence is leased, bounded, chain-specific and counted once in PostgreSQL',async t=>{
 const db=new PGlite();
 const scalar=async(sql:string,params:any[]=[])=>Object.values((await db.query(sql,params)).rows[0] as any)[0];
 const token='0x'+'1'.repeat(40),creator='0x'+'2'.repeat(40);
 await db.exec('create role anon;create role authenticated;create role service_role;');
 for(const name of ['20260903170000_pons_developer_launch_census.sql','20261002185816_alphaos_compact_alert_outcomes.sql','20261002190839_compact_outcome_sample_validation.sql','20261016070914_repair_developer_outcome_linkage.sql','20261016081140_bounded_custom_developer_verification.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 const register=async(chain='arc')=>scalar("select public.alpha_register_compact_alert($1,$2,'BOOST',1,100,100,$2,'USD')",[chain,token]);
 const claim=async()=>scalar('select public.alpha_claim_creator_verification()') as Promise<any>;
 const proof=(chain='arc')=>({chain,token,creator,source:'CHAIN_DEPLOYMENT_RECEIPT',transactionHash:'0x'+'a'.repeat(64),blockHash:'0x'+'b'.repeat(64),blockNumber:'16'});
 const finish=(c:any,p:any)=>scalar('select public.alpha_finish_creator_verification($1,$2,$3,$4)',[c.chain,c.token,c.lease,p]);
 const scenario=async(name:string,fn:()=>Promise<void>)=>t.test(name,async()=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}});
 try{
  await scenario('one global admission per ten minutes, including after restart',async()=>{
   await register();const c=await claim();assert.equal(c.chain,'arc');assert.equal(await claim(),null);
   assert.deepEqual(await finish(c,null),{status:'UNVERIFIED'});assert.equal(await claim(),null);
   await db.exec("update public.alpha_deployment_creator_evidence set checked_at=now()-interval '11 minutes'");assert.equal(await claim(),null);
  });
  await scenario('successful ARC proof attaches active identity without counting an unassessed session',async()=>{
   await register();await register('robinhood');const c=await claim();
   assert.deepEqual(await finish(c,proof()),{status:'VERIFIED',link:'LINKED_ACTIVE'});
   assert.equal(await scalar("select creator from public.alpha_compact_tracking where chain='arc'"),creator);
   assert.equal(await scalar("select creator from public.alpha_compact_tracking where chain='robinhood'"),null);
   assert.equal(await scalar('select count(*) from public.alpha_creator_outcome_summary'),0);
   assert.deepEqual(await finish(c,proof()),{status:'STALE'});
  });
  await scenario('completed ARC outcome and winner copy produce one creator counter without changing ROI',async()=>{
   await register();await db.exec("update public.alpha_compact_tracking set finalized_at=now(),outcome='WINNER'");
   await db.query("insert into public.alpha_successful_tokens(chain,token,feed,price_unit,baseline_price,final_roi,sampled_peak_roi,sampled_low_roi,samples) values('arc',$1,'BOOST','USD',1,50,60,-5,'[]')",[token]);
   const c=await claim();assert.deepEqual(await finish(c,proof()),{status:'VERIFIED',link:'LINKED_COMPLETED'});
   assert.deepEqual(await scalar('select public.alpha_reconcile_compact_creators(25)'),{});
   assert.equal(Number(await scalar('select assessed_sessions from public.alpha_creator_outcome_summary')),1);
   assert.equal(await scalar('select final_roi from public.alpha_successful_tokens'),50);
  });
  await scenario('wrong-chain proof is rejected atomically',async()=>{
   await register();const c=await claim();await assert.rejects(()=>finish(c,proof('robinhood')),/Invalid deployment proof/);
  });
  await scenario('Robinhood census does not establish ARC identity for the same address',async()=>{
   await register();await db.query("insert into public.pons_launches(chain,protocol,protocol_version,factory_address,token_address,deployer_address,block_number,block_timestamp,transaction_hash,log_index) values('robinhood','pons','v2','0x0c37a24f5d23a486fa692d1500881d698b1f77a4',$1,$2,1,now(),$3,0)",[token,creator,'0x'+'a'.repeat(64)]);
   assert.equal(await scalar("select public.alpha_link_compact_creator('arc',$1)",[token]),'UNVERIFIED');
  });
  await scenario('public roles have no access to deployment evidence or verification RPCs',async()=>{
   for(const role of ['anon','authenticated']){
    assert.equal(await scalar("select has_table_privilege($1,'public.alpha_deployment_creator_evidence','select')",[role]),false);
    assert.equal(await scalar("select has_function_privilege($1,'public.alpha_claim_creator_verification()','execute')",[role]),false);
   }
  });
 }finally{await db.close();}
});
