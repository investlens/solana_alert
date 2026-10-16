import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';

test('classification and bounded retention preserve useful history in PostgreSQL',async t=>{
 const db=new PGlite();
 const token=(n:number)=>'0x'+n.toString(16).padStart(40,'0');
 const creator=token(999);
 const scalar=async(sql:string,params:any[]=[])=>Object.values((await db.query(sql,params)).rows[0] as any)[0];
 await db.exec('create role anon;create role authenticated;create role service_role;');
 for(const name of ['20260903170000_pons_developer_launch_census.sql','20261002185816_alphaos_compact_alert_outcomes.sql','20261002190839_compact_outcome_sample_validation.sql','20261016070914_repair_developer_outcome_linkage.sql','20261016081140_bounded_custom_developer_verification.sql','20261016082306_recover_custom_developer_claims.sql','20261016083625_token_classification_retention.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 const track=async(n:number,outcome:string|null='FAILED',age=8)=>{
  await db.query("insert into public.alpha_compact_tracking(chain,token,feed,pair_id,price_unit,baseline_price,creator,creator_source,started_at,finalized_at,outcome) values('robinhood',$1,'BOOST',$1,'USD',1,$2,'CHAIN_DEPLOYMENT_RECEIPT',now()-interval '10 days',case when $3::text is null then null else now()-make_interval(days=>$4) end,$3)",[token(n),creator,outcome,age]);
 };
 const archive=async(n:number,baseline=1)=>db.query("insert into public.alpha_successful_tokens(chain,token,feed,price_unit,baseline_price,final_roi,sampled_peak_roi,sampled_low_roi,samples) values('robinhood',$1,'BOOST','USD',$2,50,60,-5,'[]')",[token(n),baseline]);
 const classify=(n:number)=>scalar("select category from public.alpha_token_classification where chain='robinhood' and token=$1",[token(n)]);
 const risk=async(n:number,status='CONFIRMED_HARMFUL',reason='REVIEWED_ONCHAIN_SELL_RESTRICTION')=>scalar('select public.alpha_set_reviewed_token_risk($1,$2,$3,$4,$5,$6,$7)',['robinhood',token(n),status,reason,'0x'+'a'.repeat(64),'review-20261016-1','Reviewed chain execution evidence demonstrates the restriction.']);
 const evidence=async(n:number)=>db.query("insert into public.alpha_deployment_creator_evidence(chain,token,status,checked_at,lease,creator,transaction_hash,block_number,block_hash) values('robinhood',$1,'VERIFIED',now()-interval '8 days','00000000-0000-0000-0000-000000000001',$2,$3,1,$4)",[token(n),creator,'0x'+'a'.repeat(64),'0x'+'b'.repeat(64)]);
 const maintain=()=>scalar('select public.alpha_compact_maintenance()');
 const scenario=(name:string,fn:()=>Promise<void>)=>t.test(name,async()=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}});
 try{
  await scenario('neutral, failed and missing evidence have distinct categories; active is not failed',async()=>{
   const cases:[string|null,string][]=[['WINNER','WINNER'],['FAILED','FAILED'],['NEUTRAL','OTHER_OBSERVED'],['INCOMPLETE','UNVERIFIED_INCOMPLETE'],[null,'TRACKING']];
   for(const [i,[outcome,label]]of cases.entries()){await track(i+1,outcome);assert.equal(await classify(i+1),label);}
   assert.equal(await scalar('select count(*) from public.alpha_reviewed_token_risk'),0);
  });
  await scenario('cleanup removes at most 25 expired details and preserves creator/feed totals and active/recent sessions',async()=>{
   for(let i=1;i<=30;i++)await track(i);
   await track(31,null);await track(32,'FAILED',1);
   await db.query("insert into public.alpha_creator_outcome_summary(chain,creator,assessed_sessions,failed) values('robinhood',$1,30,30)",[creator]);
   await db.exec("insert into public.alpha_feed_outcome_daily(day,chain,feed,tracked,failed) values(current_date,'robinhood','BOOST',30,30)");
   const before=await scalar("select jsonb_build_object('creators',(select jsonb_agg(s) from public.alpha_creator_outcome_summary s),'feeds',(select jsonb_agg(f) from public.alpha_feed_outcome_daily f))");
   assert.equal(await maintain(),25);assert.equal(await scalar('select count(*) from public.alpha_compact_tracking'),7);
   assert.equal(await maintain(),5);assert.equal(await scalar('select count(*) from public.alpha_compact_tracking'),2);
   assert.deepEqual(await scalar("select jsonb_build_object('creators',(select jsonb_agg(s) from public.alpha_creator_outcome_summary s),'feeds',(select jsonb_agg(f) from public.alpha_feed_outcome_daily f))"),before);
  });
  await scenario('winner details require a matching durable archive before deletion',async()=>{
   await track(1,'WINNER');await track(2,'WINNER');await track(3,'WINNER');
   await archive(2);await archive(3,2);
   assert.equal(await maintain(),1);assert.equal(await classify(2),'WINNER');
   assert.equal(await scalar("select count(*) from public.alpha_compact_tracking where outcome='WINNER'"),2);
   assert.equal(await scalar('select final_roi from public.alpha_successful_tokens where token=$1',[token(2)]),50);
  });
  await scenario('known-developer failures expire after 48h while unknown and neutral cases retain seven days',async()=>{
   await track(1,'FAILED',3);await track(2,'FAILED',3);await track(3,'INCOMPLETE',3);await track(4,'NEUTRAL',3);
   await db.query('update public.alpha_compact_tracking set creator=null,creator_source=null where token=$1',[token(2)]);
   assert.equal(await maintain(),2);assert.equal(await scalar('select count(*) from public.alpha_compact_tracking'),2);
   assert.equal(await classify(2),'FAILED');assert.equal(await classify(4),'OTHER_OBSERVED');
  });
  await scenario('reviewed harmful proof survives detail expiry; performance stays separate and retractions are visible',async()=>{
   await track(1,'WINNER');await archive(1);await risk(1);
   assert.equal(await classify(1),'CONFIRMED_HARMFUL');
   assert.equal(await scalar('select outcome from public.alpha_token_classification where token=$1',[token(1)]),'WINNER');
   await maintain();assert.equal(await classify(1),'CONFIRMED_HARMFUL');
   await risk(1,'RETRACTED');assert.equal(await classify(1),'WINNER');
   assert.equal(await scalar('select count(*) from public.alpha_reviewed_token_risk'),1);
  });
  await scenario('a failed or incomplete outcome never silently tags a scam, and unsupported reasons are rejected',async()=>{
   await track(1);await track(2,'INCOMPLETE');
   assert.equal(await classify(1),'FAILED');assert.equal(await classify(2),'UNVERIFIED_INCOMPLETE');
   await assert.rejects(()=>risk(1,'CONFIRMED_HARMFUL','PRICE_DROP'),/Reviewed on-chain evidence required/);
  });
  await scenario('recoverable identity is linked before its expired session can be deleted',async()=>{
   await track(1);await db.exec('update public.alpha_compact_tracking set creator=null,creator_source=null');await evidence(1);
   assert.equal(await maintain(),0);
   assert.equal(await scalar("select public.alpha_link_compact_creator('robinhood',$1)",[token(1)]),'LINKED_COMPLETED');
   assert.equal(await maintain(),1);assert.equal(Number(await scalar('select assessed_sessions from public.alpha_creator_outcome_summary')),1);
  });
  await scenario('orphan losing proof cleanup is capped at 25; winner and reviewed-risk proof is retained',async()=>{
   for(let i=1;i<=30;i++)await evidence(i);
   await evidence(31);await archive(31);await evidence(32);await risk(32);
   await maintain();assert.equal(await scalar('select count(*) from public.alpha_deployment_creator_evidence'),7);
   await maintain();assert.equal(await scalar('select count(*) from public.alpha_deployment_creator_evidence'),2);
   assert.equal(await classify(32),'CONFIRMED_HARMFUL');
   assert.equal(await scalar('select creator from public.alpha_reviewed_token_risk'),creator);
  });
  await scenario('old verification-claim path cannot delete proof needed by a reviewed risk',async()=>{
   await evidence(1);await risk(1);assert.equal(await scalar('select public.alpha_claim_creator_verification()'),null);
   assert.equal(await scalar('select count(*) from public.alpha_deployment_creator_evidence'),1);
  });
  await scenario('late verified identity enriches a reviewed risk without changing its evidence or review time',async()=>{
   await risk(1);assert.equal(await scalar('select creator from public.alpha_reviewed_token_risk'),null);
   const before=await scalar("select to_jsonb(r)-'creator'-'creator_source' from public.alpha_reviewed_token_risk r");
   await evidence(1);await maintain();assert.equal(await scalar('select creator from public.alpha_reviewed_token_risk'),creator);
   assert.deepEqual(await scalar("select to_jsonb(r)-'creator'-'creator_source' from public.alpha_reviewed_token_risk r"),before);
  });
  await scenario('classification and reviewed-risk writes are private to the backend',async()=>{
   for(const role of ['anon','authenticated']){
    assert.equal(await scalar("select has_table_privilege($1,'public.alpha_token_classification','select')",[role]),false);
    assert.equal(await scalar("select has_table_privilege($1,'public.alpha_reviewed_token_risk','insert')",[role]),false);
    assert.equal(await scalar("select has_function_privilege($1,'public.alpha_set_reviewed_token_risk(text,text,text,text,text,text,text)','execute')",[role]),false);
   }
  });
 }finally{await db.close();}
});
