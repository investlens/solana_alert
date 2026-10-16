import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';
import {parseWinnerSnapshot} from '../src/chains/robinhood/ponsReturningWinner.js';
test('winner reputation uses distinct winners against bounded indexed launches rather than sparse sessions',async t=>{
 const db=new PGlite(),creator='0x'+'2'.repeat(40),token=(n:number)=>'0x'+n.toString(16).padStart(40,'0');
 const scalar=async(sql:string,params:any[]=[])=>Object.values((await db.query(sql,params)).rows[0] as any)[0];
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec('create table public.strategy_registry(strategy_key text primary key,name text,description text,chain text,category text,enabled boolean,user_visible boolean,default_user_enabled boolean,execution_mode text,default_action text,priority int)');
 await db.exec('create table public.user_strategy_preferences(telegram_id text,strategy_key text references public.strategy_registry(strategy_key),enabled boolean,primary key(telegram_id,strategy_key))');
 for(const name of ['20260903170000_pons_developer_launch_census.sql','20261002185816_alphaos_compact_alert_outcomes.sql','20261002190839_compact_outcome_sample_validation.sql','20261016070914_repair_developer_outcome_linkage.sql','20261016081140_bounded_custom_developer_verification.sql','20261016082306_recover_custom_developer_claims.sql','20261016083625_token_classification_retention.sql','20261016094656_returning_winner_history.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261016162316_returning_winner_quality_gate.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261016162449_returning_winner_sample_shape.sql',import.meta.url),'utf8'));
 const seed=async(launches=5,winners=3,recent=false)=>{
  await db.query("insert into public.alpha_creator_outcome_summary(chain,creator,assessed_sessions,winners) values('robinhood',$1,$2,$2)",[creator,winners]);
  for(let n=1;n<=launches;n++)await db.query("insert into public.pons_launches(chain,protocol,protocol_version,factory_address,token_address,deployer_address,block_number,block_timestamp,transaction_hash,log_index) values('robinhood','pons','v2-current','0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e',$1,$2,27027400,now()-$3::interval,$4,$5)",[token(n),creator,recent?'1 hour':'2 days','0x'+'a'.repeat(64),n]);
  for(let n=1;n<=winners;n++){
   const at=Date.now()-86400000,samples=[110,120,150].map((price,i)=>({status:'MEASURED',price,at:new Date(at-[345*60000,300*60000,1000][i]).toISOString()}));
   await db.query("insert into public.alpha_successful_tokens(chain,token,feed,creator,creator_source,price_unit,baseline_price,final_roi,sampled_peak_roi,sampled_low_roi,samples,assessed_at) values('robinhood',$1,'BOOST',$2,'PONS_FACTORY_EVENT','USD',100,50,50,0,$3,$4)",[token(n),creator,JSON.stringify(samples),new Date(at).toISOString()]);
  }
 };
 const snapshot=()=>scalar('select public.alpha_returning_winner_history()') as Promise<any>;
 const scenario=(name:string,fn:()=>Promise<void>)=>t.test(name,async()=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}});
 try{
  await scenario('three measured distinct winners across five indexed launches qualify with explicit coverage',async()=>{await seed();const p=await snapshot();assert.equal(p.policy_version,2);assert.equal(p.developers.length,1);assert.equal(p.developers[0].known_launches,5);assert.equal(p.developers[0].verified_winning_tokens,3);assert.equal(parseWinnerSnapshot(p,Date.now())!.developers.size,1);});
  await scenario('reported 200-launch developer with one winner cannot qualify',async()=>{await seed(200,1);assert.equal((await snapshot()).developers.length,0);});
  await scenario('three session wins for one unique token cannot qualify',async()=>{await seed();await db.exec("delete from public.alpha_successful_tokens where token<>'"+token(1)+"'");assert.equal((await snapshot()).developers.length,0);});
  await scenario('less than sixty percent demonstrated winners fails even when aggregate sessions look good',async()=>{await seed(6);assert.equal((await snapshot()).developers.length,0);});
  await scenario('fifty indexed launch events excludes even an otherwise high-success developer',async()=>{await seed(50,40);assert.equal((await snapshot()).developers.length,0);});
  await scenario('more than five fresh launches in a day is excluded',async()=>{await seed(6,6,true);assert.equal((await snapshot()).developers.length,0);});
  await scenario('malformed sample timestamps and invented ROI cannot inflate winner coverage',async()=>{await seed();await db.query('update public.alpha_successful_tokens set samples=$1 where token=$2',[JSON.stringify([{status:'MEASURED',price:150,at:'not a date'},{status:'MEASURED',price:150,at:'bad'},{status:'MEASURED',price:150,at:'bad'}]),token(1)]);assert.equal((await snapshot()).developers.length,0);});
  await scenario('missing or wrong-factory census cannot establish qualifying history',async()=>{await seed();await db.exec("update public.pons_launches set factory_address='0x0000000000000000000000000000000000000001'");assert.equal((await snapshot()).developers.length,0);});
  await scenario('private snapshot preserves cumulative outcomes and never enables feed by itself',async()=>{await seed();const before=await scalar('select to_jsonb(s) from public.alpha_creator_outcome_summary s');await snapshot();assert.deepEqual(await scalar('select to_jsonb(s) from public.alpha_creator_outcome_summary s'),before);for(const role of ['anon','authenticated'])assert.equal(await scalar("select has_function_privilege($1,'public.alpha_returning_winner_history()','execute')",[role]),false);});
 }finally{await db.close();}
});
