import test from 'node:test';
import assert from 'node:assert/strict';
import {getPonsFactoryDeployments} from '../src/chains/robinhood/ponsContracts.js';
import type {PonsLaunch} from '../src/chains/robinhood/ponsHistoricalLaunchScanner.js';
import {createReturningWinnerQueue,freshVerifiedPonsLaunch,parseWinnerSnapshot,returningWinnerHistory,returningWinnerCard,validPriorWinner} from '../src/chains/robinhood/ponsReturningWinner.js';
import {deliverReturningWinner,recheckReturningWinner} from '../src/chains/robinhood/ponsReturningWinnerDelivery.js';
import {LIVE_ALERT_FEEDS,resolveLivePreferences,compatibleLivePreferences} from '../src/services/liveAlertPreferences.js';
import {createPonsLiveLaunchRouter} from '../src/chains/robinhood/ponsLiveLaunchRouter.js';
import {cleanAlertCard} from '../src/ui/alertCardLayout.js';
const now=Date.parse('2026-10-16T10:00:00Z'),address=(n:number)=>'0x'+n.toString(16).padStart(40,'0');
const factory=getPonsFactoryDeployments().find(f=>f.id==='v2-current')!;
const launch=(n=1):PonsLaunch=>({chain:'robinhood',protocol:'pons',protocol_version:factory.id,factory_address:factory.address,
 token_address:address(n),deployer_address:address(2),curve_address:address(3),pool_address:null,pair_token_address:null,launch_config_id:null,graduation_threshold:null,initial_buy_amount:null,
 block_number:String((factory.startBlock??1n)+1n),block_timestamp:new Date(now-5000).toISOString(),transaction_hash:'0x'+'a'.repeat(64),log_index:0});
const winner=(token=address(4),at=now-3600000)=>({chain:'robinhood',token,creator:address(2),creator_source:'PONS_FACTORY_EVENT',price_unit:'USD',baseline_price:100,final_roi:50,sampled_low_roi:0,
 samples:[110,120,150].map((price,i)=>({status:'MEASURED',price,at:new Date(at-[345*60000,300*60000,1000][i]).toISOString()})),assessed_at:new Date(at).toISOString()});
const reference=(token=address(4),at=now-3600000)=>({token,pool:address(400),source:'PONS_V2_GRADUATED_MAPPED_POOL' as const,observed_at:new Date(at).toISOString()});
const payload=()=>({policy_version:4,as_of:new Date(now).toISOString(),capped:false,developers:[{creator:address(2),known_launches:10,dex_projects:3,history_scope:'PRIOR_LAUNCHES',dex_references:[reference(),reference(address(5)),reference(address(6))]}]});

const flush=()=>new Promise<void>(r=>setImmediate(r));
test('only fresh exact approved PONS launch events qualify',()=>{
 assert.equal(freshVerifiedPonsLaunch(launch(),now),true);
 for(const bad of [{...launch(),chain:'arc'}, {...launch(),factory_address:address(99)}, {...launch(),protocol_version:'v2'},
  {...launch(),deployer_address:address(0)},{...launch(),transaction_hash:'bad'},{...launch(),block_number:'0'},
  {...launch(),block_timestamp:new Date(now-11*60000).toISOString()},{...launch(),block_timestamp:new Date(now+60000).toISOString()}])assert.equal(freshVerifiedPonsLaunch(bad as PonsLaunch,now),false);
});
test('prior winners require verified identity, measured arithmetic and complete ordered samples',()=>{
 assert.equal(validPriorWinner(winner(),address(2)),true);
 for(const bad of [{...winner(),chain:'arc'},{...winner(),creator:address(99)},{...winner(),creator_source:'WALLET_BALANCE'},
  {...winner(),final_roi:500},{...winner(),sampled_low_roi:-80},{...winner(),samples:winner().samples.slice(1)},
  {...winner(),samples:winner().samples.map(s=>({...s,status:'UNAVAILABLE'}))},
  {...winner(),samples:[...winner().samples].reverse()}])assert.equal(validPriorWinner(bad,address(2)),false);
});
test('self, future, stale and unverified history cannot create a returning-winner alert',()=>{
 const snapshot=parseWinnerSnapshot(payload(),now)!;assert.equal(returningWinnerHistory(launch(),snapshot,now)?.dex_projects,3);
 for(const prior of [reference(launch().token_address),reference(address(4),now+1000)]){
  const p=payload();p.developers[0].dex_references=[prior];const parsed=parseWinnerSnapshot(p,now)!;
  assert.equal(returningWinnerHistory(launch(),parsed,now),null);
 }
 const p=payload();p.developers[0].known_launches=200;assert.equal(parseWinnerSnapshot(p,now)!.developers.size,0);
 assert.equal(parseWinnerSnapshot({...payload(),as_of:new Date(now-6*60000).toISOString()},now),null);
});
test('card states the thirty percent DEX ratio separately from investment returns',()=>{
 const history=returningWinnerHistory(launch(),parseWinnerSnapshot(payload(),now)!,now)!;
 const text=returningWinnerCard(launch(),history,{name:'<fake>',symbol:'A&B'});
 assert.match(text,/3 \/ 10 prior projects · 30.0%/);assert.match(text,/new launch is excluded/);assert.match(text,/LP lock: <b>Unable to verify/);assert.match(text,/&lt;fake&gt;/);
 assert.match(text,/Investment performance: Unverified/);
 assert.doesNotMatch(text,/six-hour|6h sample|RETURNING WINNER|buy now|5 seconds|30 seconds/i);
});
test('small developer samples remain factual and render one grouped LP warning',()=>{
 const history={creator:address(2),known_launches:3,dex_projects:1,dex_references:[reference()],history_scope:'PRIOR_LAUNCHES' as const};
 const text=cleanAlertCard(returningWinnerCard(launch(),history));
 assert.match(text,/1 \/ 3 prior projects · 33.3%/);
 assert.match(text,/Limited launch history sample/);assert.match(text,/Investment performance: Unverified/);
 assert.match(text,/name unavailable/);assert.doesNotMatch(text,/name pending|winning developer|proven developer/i);
 assert.equal((text.match(/LP lock:/g)??[]).length,1);
 assert.equal((text.match(/RISKY ALERT — LP LOCK STATUS UNAVAILABLE/g)??[]).length,1);
 assert.ok(text.indexOf('<b>RISK</b>')<text.indexOf('RISKY ALERT'));
 assert.equal(cleanAlertCard(text),text);
});
test('queue coalesces history reads and duplicate launches; waiting work stays bounded and expires',async()=>{
 let reads=0,sends=0,clock=now;const q=createReturningWinnerQueue({now:()=>clock,load:async()=>{reads++;return payload();},send:async()=>{sends++;}});
 q.enqueue(launch());q.enqueue(launch());await q.tick();await flush();assert.equal(reads,1);assert.equal(sends,1);
 q.enqueue(launch());await q.tick();assert.equal(sends,1);
 for(let i=10;i<130;i++)q.enqueue({...launch(i),deployer_address:address(999)});
 await q.tick();assert.equal(q.stats().pending,100);assert.equal(reads,1);
 clock+=11*60000;await q.tick();assert.equal(q.stats().pending,0);
});
test('failed reads retry on a later existing minute tick; failed sends have one bounded retry',async()=>{
 let clock=now,reads=0,sends=0;
 const q=createReturningWinnerQueue({now:()=>clock,load:async()=>{if(++reads===1)throw Error('busy');return {...payload(),as_of:new Date(clock).toISOString()};},send:async()=>{sends++;throw Error('delivery store unavailable');}});
 q.enqueue(launch());await q.tick();await flush();assert.equal(reads,1);assert.equal(sends,0);
 clock+=60000;await q.tick();await flush();assert.equal(reads,2);assert.equal(sends,1);
 await q.tick();await flush();assert.equal(sends,1);
 clock+=60000;await q.tick();await flush();assert.equal(sends,2);assert.equal(q.stats().pending,0);
});
test('delivery jobs remain capped at two while later qualifying launches wait',async()=>{
 const releases:Array<()=>void>=[];let sends=0;
 const q=createReturningWinnerQueue({now:()=>now,load:async()=>payload(),send:async()=>{sends++;await new Promise<void>(r=>releases.push(r));}});
 q.enqueue(launch(10));q.enqueue(launch(11));q.enqueue(launch(12));await q.tick();await flush();
 assert.equal(sends,2);assert.equal(q.stats().active,2);assert.equal(q.stats().pending,1);
 releases.shift()!();await flush();assert.equal(sends,3);assert.equal(q.stats().active,2);
 while(releases.length)releases.shift()!();await flush();assert.equal(q.stats().active,0);
});
test('recipient dedup is separate, preferences respected, and every sent recipient uses shared timing',async()=>{
 const keys=new Set<string>(),waited:string[]=[],sent:string[]=[];
 const history=returningWinnerHistory(launch(),parseWinnerSnapshot(payload(),now)!,now)!;
 const deps={now:()=>now,recipients:async()=>['1','pro','free','muted'],enabled:async(users:string[])=>users.filter(u=>u!=='muted'),
  claim:async(key:string)=>{if(keys.has(key))return 'EXISTS' as const;keys.add(key);return 'CLAIMED' as const;},wait:async(user:string,at:number)=>{assert.equal(at,now);waited.push(user);},
  send:async(user:string,text:string,keyboard:any)=>{assert.match(text,/DEX TRACK RECORD/);assert.match(keyboard[0][0].url,/ponsfamily/);sent.push(user);}};
 assert.equal((await deliverReturningWinner(launch(),history,deps)).delivered,3);
 assert.equal((await deliverReturningWinner(launch(),history,deps)).deduplicated,3);
 assert.deepEqual([...sent].sort(),['1','free','pro']);assert.equal(waited.length,3);
 assert.ok([...keys].every(k=>k.startsWith('alphaos:returning-winner:')&&!k.includes('boost')));
});
test('unavailable claims fail closed and ambiguous Telegram failures never get a second send',async()=>{
 const history=returningWinnerHistory(launch(),parseWinnerSnapshot(payload(),now)!,now)!;let sends=0,claimed=false;
 const deps={now:()=>now,recipients:async()=>['user'],enabled:async(u:string[])=>u,wait:async()=>{},send:async()=>{sends++;throw Error('ambiguous timeout');},
  claim:async()=>{if(claimed)return 'EXISTS' as const;claimed=true;return 'CLAIMED' as const;}};
 assert.equal((await deliverReturningWinner(launch(),history,deps)).failed,1);await deliverReturningWinner(launch(),history,deps);assert.equal(sends,1);
 await assert.rejects(()=>deliverReturningWinner(launch(),history,{...deps,claim:async()=> 'UNAVAILABLE'}),/store unavailable/);assert.equal(sends,1);
});
test('new feed preserves old mutes and accepts pre-upgrade cached preferences without a refresh storm',()=>{
 const old=resolveLivePreferences(new Map([['RH_BOOST',false],['DEX_PAID',false]])) as any;delete old.RH_RETURNING_WINNER_DEV;
 const updated=compatibleLivePreferences(old)!;assert.equal(updated.RH_BOOST,false);assert.equal(updated.DEX_PAID,false);assert.equal(updated.RH_RETURNING_WINNER_DEV,true);
 assert.equal(resolveLivePreferences(new Map([['RH_RETURNING_WINNER_DEV',false]])).RH_RETURNING_WINNER_DEV,false);
 assert.equal(LIVE_ALERT_FEEDS.filter(f=>f.key==='RH_RETURNING_WINNER_DEV').length,1);
});
test('returning-winner hook is optional, respects registry blocks and cannot break the normal launch path',async()=>{
 const config={liveIntelligenceEnabled:true,provenDeveloperAlertsEnabled:false,shadowBuyEnabled:false,confirmationSeconds:0,successfulDeveloperMinPeakMarketCap:300000};
 let calls=0;const base={config,lookupDeveloper:async()=>null,log:()=>{}};
 const result=await createPonsLiveLaunchRouter({...base,queueReturningWinner:()=>{calls++;throw Error('isolated feature failed');}})(launch());
 assert.equal(result.status,'NORMAL_PATH');assert.equal(calls,1);
 await createPonsLiveLaunchRouter({...base,lookupDeveloper:async()=>({isBlocked:true,riskTier:'SCAMMER',tier:'SCAMMER'}) as any,queueReturningWinner:()=>{calls++;}})(launch());assert.equal(calls,1);
});
test('thirty percent is exact, without sixty percent or fixed launch-count caps',()=>{
 assert.equal(parseWinnerSnapshot(payload(),now)!.developers.size,1);
 for(const [projects,dex,allowed] of [[10,3,true],[200,6,false],[200,60,true],[10,2,false],[3,1,true]] as const){
  const p=payload();p.developers[0].known_launches=projects;p.developers[0].dex_projects=dex;p.developers[0].dex_references=[reference()];
  assert.equal(parseWinnerSnapshot(p,now)!.developers.size,allowed?1:0);
 }
 assert.equal(parseWinnerSnapshot({...payload(),policy_version:2},now),null);
});
test('fresh recheck requires prior-project scope and cannot use the shortlist as final qualification',async()=>{
 assert.ok(await recheckReturningWinner(launch(),async()=>payload(),()=>now));
 const p=payload();p.developers[0].known_launches=200;
 assert.equal(await recheckReturningWinner(launch(),async()=>p,()=>now),null);
 const candidate=payload();candidate.developers[0].history_scope='SHORTLIST';
 assert.equal(await recheckReturningWinner(launch(),async()=>candidate,()=>now),null);
 await assert.rejects(()=>recheckReturningWinner(launch(),async()=>null,()=>now),/unavailable/);
});
