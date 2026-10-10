import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreDexPaidWatch,snapshotDexPaidWatch,seedDexPaidWatch,dexPaidFeedCandidates,dexPaidWatchLimit,recentDexPayment,DEX_PAID_PAYMENT_MAX_AGE_SECONDS,rememberDexPaidCandidate,selectDexPaidCandidates} from '../src/chains/robinhood/dexPaidWatchState.js';
const now=Date.now();
const token={chain:'robinhood' as const,tokenAddress:'0x'+'a'.repeat(40),discoveredAt:now-1000,source:'PONS' as const,sourceType:'LAUNCHPAD' as const,sources:[]};
test('restart checkpoint preserves scheduling and strips bulky unneeded metadata',()=>{
 const original={token:{...token,metadata:{image:'junk',nested:100}},lastSeenAt:now-1000,lastCheckedAt:now-500};
 const restored=restoreDexPaidWatch(snapshotDexPaidWatch([original],now,24),now+1000,24);
 assert.equal(restored.length,1);assert.equal(restored[0].lastCheckedAt,original.lastCheckedAt);
 assert.equal(restored[0].token.metadata,undefined);
 assert.equal(restoreDexPaidWatch({version:1,candidates:[{...original,lastSeenAt:now-3600000}]},now,24).length,0);
});
test('promotion discovery includes older-token profiles and custom candidates without inventing PONS lineage',()=>{
 const rows=dexPaidFeedCandidates([{chainId:'robinhood',tokenAddress:token.tokenAddress},
  {chainId:'arc',tokenAddress:'0x'+'b'.repeat(40)},{chainId:'robinhood',tokenAddress:'junk'},
  {chainId:'robinhood',tokenAddress:token.tokenAddress.toUpperCase().replace('0X','0x')}],now);
 assert.equal(rows.length,1);assert.equal(rows[0].source,'DEXSCREENER');
 const saved=snapshotDexPaidWatch([{token:rows[0],lastSeenAt:now,lastCheckedAt:0}],now,24);
 const restored=restoreDexPaidWatch(saved,now+1000,24);
 assert.equal(restored.length,1);assert.equal(restored[0].token.sourceType,'INDEXER');
});
test('watch recovery rejects malformed, future, cross-chain and custom candidates',()=>{
 for (const changed of [{token:{...token,chain:'arc'}},{token:{...token,source:'OTHER'}},{lastSeenAt:now+1},{lastCheckedAt:now+1},{token:{...token,tokenAddress:'junk'}}]) {
  assert.equal(restoreDexPaidWatch({version:1,candidates:[{token,lastSeenAt:now,lastCheckedAt:0,...changed}]},now,24).length,0);
 }
});
test('bounded queue rotation fits freshness with a latency margin and rejects stale payments',()=>{
 const limit=dexPaidWatchLimit(30000,2);
 assert.ok(limit<=24);assert.ok(Math.ceil(limit/2)*30<=DEX_PAID_PAYMENT_MAX_AGE_SECONDS-60);
 assert.equal(recentDexPayment((now-30000)/1000,now),true);
 assert.equal(recentDexPayment((now-(DEX_PAID_PAYMENT_MAX_AGE_SECONDS+1)*1000)/1000,now),false);
 assert.equal(recentDexPayment((now+60000)/1000,now),false);
});
test('cold start seeds only recent verified factory launches from the existing Redis queue',()=>{
 const factory='0x'+'b'.repeat(40);
 const launch={chain:'robinhood',token_address:token.tokenAddress,factory_address:factory,block_timestamp:new Date(now-1000).toISOString()};
 assert.equal(seedDexPaidWatch([{launch}],now,24,[factory]).length,1);
 assert.equal(seedDexPaidWatch([{launch}],now,24,[]).length,0);
 assert.equal(seedDexPaidWatch([{launch:{...launch,block_timestamp:new Date(now-3600001).toISOString()}}],now,24,[factory]).length,0);
});

test('promotion refresh preserves the reserved PONS capacity and authoritative lineage',()=>{
 const queue=new Map();
 for(let i=0;i<18;i++)rememberDexPaidCandidate(queue,{...token,tokenAddress:'0x'+i.toString(16).padStart(40,'0')},now,24);
 for(let i=18;i<60;i++)rememberDexPaidCandidate(queue,{...token,tokenAddress:'0x'+i.toString(16).padStart(40,'0'),source:'DEXSCREENER'},now+i,24);
 assert.equal(queue.size,24);assert.equal([...queue.values()].filter(c=>c.token.source==='PONS').length,18);
 const entry=[...queue.values()][0];entry.lastCheckedAt=now-200;
 rememberDexPaidCandidate(queue,{...entry.token,source:'DEXSCREENER'},now+1,24);
 assert.equal(queue.get(entry.token.tokenAddress).token.source,'PONS');assert.equal(queue.get(entry.token.tokenAddress).lastCheckedAt,now-200);
});
test('hour-long recovery keeps a 45-minute PONS candidate but expires at one hour',()=>{
 const launch={chain:'robinhood',token_address:token.tokenAddress,factory_address:'0x'+'b'.repeat(40),block_timestamp:new Date(now-45*60000).toISOString()};
 assert.equal(seedDexPaidWatch([{launch}],now,24,[launch.factory_address]).length,1);
 assert.equal(seedDexPaidWatch([{launch:{...launch,block_timestamp:new Date(now-60*60000).toISOString()}}],now,24,[launch.factory_address]).length,0);
});

test('unused PONS capacity remains available to promotion candidates',()=>{
 const queue=new Map();
 for(let i=0;i<40;i++)rememberDexPaidCandidate(queue,{...token,tokenAddress:'0x'+(i+1).toString(16).padStart(40,'0'),source:'DEXSCREENER'},now+i,24);
 assert.equal(queue.size,24);
 rememberDexPaidCandidate(queue,token,now+41,24);
 assert.equal(queue.size,24);assert.equal(queue.get(token.tokenAddress).token.source,'PONS');
});

test('a full launch watch admits promotions and launch reseeding cannot reclaim their reserved slots',()=>{
 const queue=new Map();
 const make=(i:number,source:'PONS'|'DEXSCREENER')=>({...token,tokenAddress:'0x'+i.toString(16).padStart(40,'0'),source});
 for(let i=0;i<24;i++)rememberDexPaidCandidate(queue,make(i,'PONS'),now+i,24);
 for(let i=24;i<30;i++)assert.equal(rememberDexPaidCandidate(queue,make(i,'DEXSCREENER'),now+i,24),true);
 for(let i=30;i<100;i++)rememberDexPaidCandidate(queue,make(i,'PONS'),now+i,24);
 assert.equal(queue.size,24);
 assert.equal([...queue.values()].filter(c=>c.token.source==='PONS').length,18);
 for(let i=24;i<30;i++)assert.ok(queue.has(make(i,'DEXSCREENER').tokenAddress));
});
test('ongoing new launches cannot starve already checked promotion candidates',()=>{
 const queue=new Map();let cursor=0;const checked=new Set<string>();
 for(let i=0;i<24;i++)rememberDexPaidCandidate(queue,{...token,tokenAddress:'0x'+i.toString(16).padStart(40,'0'),source:i<18?'PONS':'DEXSCREENER'},now+i,24);
 for(const c of queue.values())c.lastCheckedAt=now-1000;
 for(let cycle=0;cycle<12;cycle++){
  rememberDexPaidCandidate(queue,{...token,tokenAddress:'0x'+(100+cycle).toString(16).padStart(40,'0')},now+cycle+100,24);
  const result=selectDexPaidCandidates(queue.values(),2,cursor);cursor=result.cursor;
  for(const c of result.selected){c.lastCheckedAt=now+cycle+100; if(c.token.source==='DEXSCREENER')checked.add(c.token.tokenAddress);}
 }
 assert.equal(checked.size,6);assert.equal(queue.size,24);
});
test('source scheduling uses spare checks when either lane is empty',()=>{
 const rows=[0,1,2].map(i=>({token:{...token,tokenAddress:'0x'+i.toString(16).padStart(40,'0')},lastSeenAt:now,lastCheckedAt:i}));
 const result=selectDexPaidCandidates(rows,4,3);
 assert.equal(result.selected.length,3);assert.equal(new Set(result.selected).size,3);
 assert.equal(result.selected[0],rows[0]);
});
