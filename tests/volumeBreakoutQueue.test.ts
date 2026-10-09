import test from 'node:test';
import assert from 'node:assert/strict';
import { considerRobinhoodVolumeBreakout, resetVolumeBreakoutQueueForTests, volumeBreakoutCard } from '../src/chains/robinhood/volumeBreakoutSetup.js';
import { scannerVolumeSnapshot, type VolumeBreakoutRead } from '../src/services/volumeBreakoutEvidence.js';
import type { ChainMarketSnapshot } from '../src/chains/shared/types.js';
const token = (i: number) => '0x'+i.toString(16).padStart(40,'0');
const market = (i: number): ChainMarketSnapshot => ({chain:'robinhood', tokenAddress:token(i),pairAddress:token(100+i),name:'Test',symbol:'TEST',priceUsd:1,liquidityUsd:20000,marketCapUsd:100000,volume5mUsd:100,buys5m:2,sells5m:1,pairCreatedAt:Date.now()-10*86400000,timestamp:Date.now()});
test('volume checks queue concurrent scanner observations with one active reader and bounded backlog', async()=>{
 resetVolumeBreakoutQueueForTests();
 let release!:()=>void; const blocked=new Promise<void>(r=>release=r); const seen:string[]=[];let active=0,maxActive=0;
 const read=async(_network:string,t:string):Promise<VolumeBreakoutRead>=>{active++;maxActive=Math.max(maxActive,active);seen.push(t);if(seen.length===1)await blocked;active--;return {evidence:null,reason:'CONDITION_WAIT'};};
 try {
  const first=considerRobinhoodVolumeBreakout(market(1),read);
  for(let i=2;i<=10;i++)await considerRobinhoodVolumeBreakout(market(i),read);
  release();await first;
  assert.equal(maxActive,1);assert.deepEqual(seen,Array.from({length:7},(_,i)=>token(i+1)));
  await considerRobinhoodVolumeBreakout(market(1),read);assert.equal(seen.length,7);
 }finally{release();resetVolumeBreakoutQueueForTests();}
});
test('temporary request capacity does not impose ten-minute token cooldown',async()=>{
 resetVolumeBreakoutQueueForTests();let calls=0;
 const read=async():Promise<VolumeBreakoutRead>=>{calls++;return {evidence:null,reason:calls===1?'CAPACITY_LIMITED':'CONDITION_WAIT'};};
 try{await considerRobinhoodVolumeBreakout(market(1),read);await considerRobinhoodVolumeBreakout(market(1),read);assert.equal(calls,2);}finally{resetVolumeBreakoutQueueForTests();}
});
test('scanner snapshot reuse rejects wrong token, pair, chain and stale data',()=>{
 const m=market(1),now=m.timestamp;
 assert.ok(scannerVolumeSnapshot(m,'robinhood',m.tokenAddress,m.pairAddress!,now));
 for(const change of [{chain:'solana' as const},{tokenAddress:token(2)},{pairAddress:token(5)},{timestamp:now-90001},{timestamp:now+1},{priceUsd:0}])assert.equal(scannerVolumeSnapshot({...m,...change},'robinhood',m.tokenAddress,m.pairAddress!,now),null);
 const s=scannerVolumeSnapshot(m,'robinhood',m.tokenAddress,m.pairAddress!,now)!;assert.equal(s.move1h,null);assert.equal(s.move24h,null);
 const text=volumeBreakoutCard(m,{...s,dailyAverage:5000,signalVolume:15000,signalMove:10,dayStart:now-86400000,multiple:3},'Research');
 assert.doesNotMatch(text,/Move · 1h|NaN|undefined/);assert.match(text,/Market: DEXScreener · History: GeckoTerminal/);
});
