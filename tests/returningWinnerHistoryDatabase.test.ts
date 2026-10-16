import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';

test('returning-winner snapshot uses verified measured history and private read-only access',async t=>{
 const db=new PGlite();const creator='0x'+'2'.repeat(40),token=(n:number)=>'0x'+n.toString(16).padStart(40,'0');
 const scalar=async(sql:string,params:any[]=[])=>Object.values((await db.query(sql,params)).rows[0] as any)[0];
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec("create table public.strategy_registry(strategy_key text primary key,name text,description text,chain text,category text,enabled boolean,user_visible boolean,default_user_enabled boolean,execution_mode text,default_action text,priority int)");
 await db.exec("create table public.user_strategy_preferences(telegram_id text,strategy_key text references public.strategy_registry(strategy_key),enabled boolean,primary key(telegram_id,strategy_key))");
 for(const name of ['20260903170000_pons_developer_launch_census.sql','20261002185816_alphaos_compact_alert_outcomes.sql','20261002190839_compact_outcome_sample_validation.sql','20261016070914_repair_developer_outcome_linkage.sql','20261016081140_bounded_custom_developer_verification.sql','20261016082306_recover_custom_developer_claims.sql','20261016083625_token_classification_retention.sql','20261016094656_returning_winner_history.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 const summary=async()=>db.query("insert into public.alpha_creator_outcome_summary(chain,creator,assessed_sessions,winners) values('robinhood',$1,5,5)",[creator]);
 const winner=async(n=1,age=24,source='PONS_FACTORY_EVENT',chain='robinhood')=>{
  const at=Date.now()-age*3600000;
  const samples=[110,120,150].map((price,i)=>({status:'MEASURED',price,at:new Date(at-[345*60000,300*60000,1000][i]).toISOString()}));
  return db.query("insert into public.alpha_successful_tokens(chain,token,feed,creator,creator_source,price_unit,baseline_price,final_roi,sampled_peak_roi,sampled_low_roi,samples,assessed_at) values($1,$2,'BOOST',$3,$4,'USD',100,50,50,0,$5,$6)",[chain,token(n),creator,source,JSON.stringify(samples),new Date(at).toISOString()]);
 };
 const snapshot=()=>scalar('select public.alpha_returning_winner_history()') as Promise<any>;
 const scenario=(name:string,fn:()=>Promise<void>)=>t.test(name,async()=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}});
 try{
  await scenario('aggregate wins alone are insufficient; a retained verified winner is required',async()=>{
   await summary();assert.equal((await snapshot()).developers.length,0);
   await winner();const p=await snapshot();assert.equal(p.developers.length,1);assert.equal(p.developers[0].winners,5);
  });
  await scenario('only three references are returned, retaining the earliest winner to avoid look-ahead misses',async()=>{
   await summary();for(let i=1;i<=5;i++)await winner(i,24-i);
   const p=await snapshot();assert.equal(p.developers[0].prior_winners.length,3);
   assert.ok(p.developers[0].prior_winners.some((w:any)=>w.token===token(1)));
  });
  await scenario('unverified identity, other-chain wins, future assessment and invalid winner ROI do not qualify',async()=>{
   await summary();await winner(1,24,'WALLET_BALANCE');await winner(2,24,'CHAIN_DEPLOYMENT_RECEIPT','arc');await winner(3,-1);await winner(4);
   await db.query('update public.alpha_successful_tokens set final_roi=-50 where token=$1',[token(4)]);
   assert.equal((await snapshot()).developers.length,0);
  });
  await scenario('reviewed harmful developer or previous token is excluded from this new discovery feed',async()=>{
   await summary();await winner();
   await db.query("insert into public.alpha_reviewed_token_risk(chain,token,status,reason,transaction_hash,review_reference,note,creator,creator_source) values('robinhood',$1,'CONFIRMED_HARMFUL','REVIEWED_ONCHAIN_SELL_RESTRICTION',$2,'review-20261016','Reviewed chain evidence establishes a restriction.',$3,'PONS_FACTORY_EVENT')",[token(99),'0x'+'a'.repeat(64),creator]);
   assert.equal((await snapshot()).developers.length,0);
   await db.exec("update public.alpha_reviewed_token_risk set status='RETRACTED'");assert.equal((await snapshot()).developers.length,1);
  });
  await scenario('snapshot is private and does not alter performance data; preference registration is manual-only',async()=>{
   await summary();await winner();const before=await scalar('select to_jsonb(w) from public.alpha_successful_tokens w');await snapshot();assert.deepEqual(await scalar('select to_jsonb(w) from public.alpha_successful_tokens w'),before);
   for(const role of ['anon','authenticated'])assert.equal(await scalar("select has_function_privilege($1,'public.alpha_returning_winner_history()','execute')",[role]),false);
   assert.equal(await scalar("select execution_mode from public.strategy_registry where strategy_key='RH_RETURNING_WINNER_DEV'"),'manual');
  });
  await scenario('batch recipient read honors persisted mutes despite legacy caches and global feed disable',async()=>{
   await db.exec("insert into public.user_strategy_preferences values('muted','RH_RETURNING_WINNER_DEV',false)");
   assert.deepEqual(await scalar("select public.alpha_returning_winner_recipients(array['new','muted','enabled'])"),['new','enabled']);
   await db.exec("update public.strategy_registry set enabled=false where strategy_key='RH_RETURNING_WINNER_DEV'");
   assert.deepEqual(await scalar("select public.alpha_returning_winner_recipients(array['new'])"),[]);
  });
 }finally{await db.close();}
});
