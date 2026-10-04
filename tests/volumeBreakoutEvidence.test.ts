import test from 'node:test';
import assert from 'node:assert/strict';
import { completedWeekAverage, poolVolumeSnapshot, qualifyVolumeBreakout } from '../src/services/volumeBreakoutEvidence.js';
const now = Date.UTC(2026, 9, 5, 12), day = 86400000, boundary = Date.UTC(2026, 9, 5);
const rows = Array.from({length:7}, (_,i) => [(boundary-(i+1)*day)/1000, 1, 2, 0.5, 1.1, 5000]);
const payload = {data:{id:'robinhood_0xpool', attributes:{address:'0xpool',base_token_price_usd:'0.01',reserve_in_usd:'20000',volume_usd:{h24:'15000'},price_change_percentage:{h24:'12',h1:'2'},market_cap_usd:null,fdv_usd:'100000',pool_created_at:new Date(boundary-10*day).toISOString()},relationships:{base_token:{data:{id:'robinhood_0xtoken'}}}}};
test('complete previous seven UTC days; exclude current incomplete candle',()=>{
 assert.equal(completedWeekAverage([...rows,[boundary/1000,1,2,0.5,1.1,999999]],now,boundary-10*day),5000);
});
test('reject missing, duplicate, malformed days and new-pool synthetic history',()=>{
 assert.equal(completedWeekAverage(rows.slice(1),now,boundary-10*day),null);
 assert.equal(completedWeekAverage([...rows,rows[0]],now,boundary-10*day),null);
 assert.equal(completedWeekAverage(rows,now,boundary-6*day),null);
 assert.equal(completedWeekAverage(rows.map((r,i)=>i===0?[...r.slice(0,5),null]:r),now,boundary-10*day),null);
 assert.equal(completedWeekAverage(rows.map(r=>[...r.slice(0,5),0]),now,boundary-10*day),null);
});
test('pool identity must match chain, pool and base token; missing valuation rejected',()=>{
 assert.ok(poolVolumeSnapshot(payload,'robinhood','0xtoken','0xpool',now));
 assert.equal(poolVolumeSnapshot(payload,'arc','0xtoken','0xpool',now),null);
 assert.equal(poolVolumeSnapshot(payload,'robinhood','0xother','0xpool',now),null);
 assert.equal(poolVolumeSnapshot(payload,'robinhood','0xtoken','0xother',now),null);
 const copy=structuredClone(payload);copy.data.attributes.fdv_usd='';
 assert.equal(poolVolumeSnapshot(copy,'robinhood','0xtoken','0xpool',now),null);
});
test('2x threshold, positive price, minimum volume/liquidity and freshness mandatory',()=>{
 const s=poolVolumeSnapshot(payload,'robinhood','0xtoken','0xpool',now)!;
 assert.equal(qualifyVolumeBreakout(s,5000,now)?.multiple,3);
 assert.equal(qualifyVolumeBreakout(s,8000,now),null);
 assert.equal(qualifyVolumeBreakout({...s,move24h:0},5000,now),null);
 assert.equal(qualifyVolumeBreakout({...s,volume24h:500},100,now),null);
 assert.equal(qualifyVolumeBreakout({...s,liquidity:500},5000,now),null);
 assert.equal(qualifyVolumeBreakout(s,5000,now+90001),null);
 assert.equal(qualifyVolumeBreakout(s,5000,now-1),null);
});

test('historical lookup reuses hourly baseline, rejects HTTP errors and respects backoff',async()=>{
 const {readVolumeBreakout}=await import('../src/services/volumeBreakoutEvidence.js');
 const original=globalThis.fetch; let dailyCalls=0;
 const liveNow=Date.now(), b=Math.floor(liveNow/day)*day;
 const candles=Array.from({length:7},(_,i)=>[(b-(i+1)*day)/1000,1,2,0.5,1.1,5000]);
 const p=structuredClone(payload);p.data.attributes.pool_created_at=new Date(b-10*day).toISOString();
 globalThis.fetch=async(input)=>{
  if(String(input).includes('/ohlcv/')) { dailyCalls++;assert.match(String(input),/token=base/);assert.match(String(input),/include_empty_intervals=false/);return new Response(JSON.stringify({data:{attributes:{ohlcv_list:candles}}})); }
  return new Response(JSON.stringify(p));
 };
 try {
  assert.ok(await readVolumeBreakout('robinhood','0xtoken','0xpool'));
  assert.ok(await readVolumeBreakout('robinhood','0xtoken','0xpool'));
  assert.equal(dailyCalls,1);
  globalThis.fetch=async()=>new Response('',{status:429});
  assert.equal(await readVolumeBreakout('robinhood','0xtoken','0xother'),null);
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('unexpected');};
  assert.equal(await readVolumeBreakout('robinhood','0xtoken','0xthird'),null);assert.equal(calls,0);
 } finally { globalThis.fetch=original; }
});
