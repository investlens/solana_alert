import test from 'node:test';
import assert from 'node:assert/strict';
import {runnerCrossings,renderCompactRunner,processCompactRunner,compactRunnerButtons,runnerSourceFeed} from '../src/services/compactRunnerMilestones.js';
import type {CompactTrackingRow} from '../src/services/compactAlertOutcomes.js';
const row:CompactTrackingRow={chain:'robinhood',token:'0x'+'a'.repeat(40),feed:'BOOST',pair_id:'0x'+'b'.repeat(40),price_unit:'USD',baseline_price:0.001,started_at:'2026-10-07T08:00:00Z',checkpoint:0,retried:false,lease:'test'};
const sample=(price:number)=>({status:'MEASURED' as const,price,mc:10000,liquidity:3000,at:'2026-10-07T08:15:00Z',name:'Token',symbol:'TOK'});
test('2x/5x/10x require measured positive same-series baselines within the existing lifetime',()=>{
 assert.deepEqual(runnerCrossings(row,sample(0.001999)),[]);
 assert.deepEqual(runnerCrossings(row,sample(0.002)),[2]);assert.deepEqual(runnerCrossings(row,sample(0.005)),[2,5]);assert.deepEqual(runnerCrossings(row,sample(0.01)),[2,5,10]);
 for(const bad of [{...row,price_unit:'ETH_RESERVE_RATIO'},{...row,baseline_price:0},{...row,chain:'unknown'},{...row,pair_id:'evil'}])assert.deepEqual(runnerCrossings(bad,sample(1)),[]);
 for(const bad of [{...sample(1),status:'UNAVAILABLE' as const},{...sample(1),price:NaN},{...sample(1),at:row.started_at},{...sample(1),at:'2026-10-07T15:00:00Z'}])assert.deepEqual(runnerCrossings(row,bad),[]);
});
test('each milestone sends once across retries/restarts and skips lower cards on a jump',async()=>{
 const claimed=new Set<string>();const sent:number[]=[];
 const deps={claim:async(key:string)=>{if(claimed.has(key))return 'EXISTS' as const;claimed.add(key);return 'CLAIMED' as const;},deliver:async(_r:any,_s:any,m:number)=>{sent.push(m);}};
 await processCompactRunner(row,sample(.002),deps);await processCompactRunner(row,sample(.0025),deps);await processCompactRunner(row,sample(.005),deps);await processCompactRunner(row,sample(.01),deps);await processCompactRunner(row,sample(.005),deps);
 assert.deepEqual(sent,[2,5,10]);assert.equal(claimed.size,3);
 claimed.clear();sent.length=0;await processCompactRunner(row,sample(.011),deps);await processCompactRunner(row,sample(.005),deps);assert.deepEqual(sent,[10]);assert.equal(claimed.size,3);
});
test('unavailable claims and ambiguous Telegram acceptance never create duplicate sends',async()=>{
 let sends=0;await processCompactRunner(row,sample(.002),{claim:async()=> 'UNAVAILABLE',deliver:async()=>{sends++;}});assert.equal(sends,0);
 const claims=new Set<string>();const deps={claim:async(key:string)=>{const result=claims.has(key)?'EXISTS' as const:'CLAIMED' as const;claims.add(key);return result;},deliver:async()=>{sends++;throw Error('timeout');}};
 await assert.rejects(processCompactRunner(row,sample(.002),deps));await processCompactRunner(row,sample(.003),deps);assert.equal(sends,1);
});
test('card shows original/observed evidence and never calls sampled price changes profit or ATH',()=>{
 const text=renderCompactRunner(row,sample(.01),10);assert.match(text,/MEGA RUNNER/);assert.match(text,/10× SINCE ALERT/);assert.match(text,/Market cap/);assert.match(text,/Alert price/);assert.match(text,/Observed price/);assert.match(text,/not realised profit/);assert.match(text,/not lifetime ATH/);assert.match(text,/not a buy\/sell signal/);assert.ok(text.replace(/<[^>]*>/g,'').length<1024);
 assert.match(renderCompactRunner(row,{...sample(.002),liquidity:1,name:'<script>'},2),/Liquidity is thin/);assert.doesNotMatch(renderCompactRunner(row,{...sample(.002),name:'<script>'},2),/<script>/);
 const arc={...row,chain:'arc'};assert.equal(runnerSourceFeed('arc','BOOST'),'ARC_BOOST');assert.match(compactRunnerButtons(arc)[1][0].url!,/explorer.arc.io/);assert.match(compactRunnerButtons(arc)[0][0].url!,/dexscreener.com\/arc/);
});

test('50x and 100x require exact thresholds and send once through normal progression',async()=>{
 assert.deepEqual(runnerCrossings(row,sample(.049999)),[2,5,10]);
 assert.deepEqual(runnerCrossings(row,sample(.05)),[2,5,10,50]);
 assert.deepEqual(runnerCrossings(row,sample(.099999)),[2,5,10,50]);
 assert.deepEqual(runnerCrossings(row,sample(.1)),[2,5,10,50,100]);
 const claimed=new Set<string>(),sent:number[]=[];
 const deps={claim:async(key:string)=>{if(claimed.has(key))return 'EXISTS' as const;claimed.add(key);return 'CLAIMED' as const;},deliver:async(_r:any,_s:any,m:number)=>{sent.push(m);}};
 for(const p of [.002,.005,.01,.05,.06,.1,.12,.05])await processCompactRunner(row,sample(p),deps);
 assert.deepEqual(sent,[2,5,10,50,100]);assert.equal(claimed.size,5);
 claimed.clear();sent.length=0;
 await processCompactRunner(row,sample(.1),deps);await processCompactRunner(row,sample(.05),deps);
 assert.deepEqual(sent,[100]);assert.equal(claimed.size,5);
 for(const m of [50,100]){
  const text=renderCompactRunner(row,sample(m*.001),m);
  assert.match(text,new RegExp(m+'× SINCE ALERT'));assert.match(text,/Alert price/);assert.match(text,/not realised profit/);
  assert.ok(text.replace(/<[^>]*>/g,'').length<1024);
 }
 assert.match(renderCompactRunner(row,sample(.05),50),/ULTRA RUNNER/);
 assert.match(renderCompactRunner(row,sample(.1),100),/LEGENDARY RUNNER/);
});
