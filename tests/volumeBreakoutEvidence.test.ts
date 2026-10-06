import test from 'node:test';
import assert from 'node:assert/strict';
import { completedWeekAverage, completedVolumeWindow, poolVolumeSnapshot, qualifyVolumeBreakout } from '../src/services/volumeBreakoutEvidence.js';
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
test('non-overlapping eight-day signal, positive daily candle and fresh snapshot',()=>{
 const candles=Array.from({length:8},(_,i)=>[(boundary-(i+1)*day)/1000,1,2,0.5,1.1,i===0?15000:5000]);
 const w=completedVolumeWindow(candles,now,boundary-10*day)!;
 assert.equal(w.dailyAverage,5000);assert.equal(w.signalVolume,15000);
 const s=poolVolumeSnapshot(payload,'robinhood','0xtoken','0xpool',now)!;
 assert.equal(qualifyVolumeBreakout(s,w,now)?.multiple,3);
 assert.equal(qualifyVolumeBreakout(s,{...w,dailyAverage:8000},now),null);
 assert.equal(qualifyVolumeBreakout(s,{...w,signalMove:0},now),null);
 assert.equal(qualifyVolumeBreakout(s,{...w,signalVolume:500},now),null);
 assert.equal(qualifyVolumeBreakout({...s,liquidity:500},w,now),null);
 assert.equal(qualifyVolumeBreakout(s,w,now+90001),null);
 assert.equal(qualifyVolumeBreakout(s,w,now-1),null);
 assert.equal(completedVolumeWindow(candles.slice(0,7),now,boundary-10*day),null);
 assert.equal(completedVolumeWindow([...candles,candles[0]],now,boundary-10*day),null);
 assert.equal(completedVolumeWindow(candles,now,boundary-7*day),null);
 // Rolling snapshot direction must not substitute for the measured daily candle.
 assert.ok(qualifyVolumeBreakout({...s,move24h:-2},w,now));
});

test('diagnostics distinguish malformed market data from a readable nonqualifying market',async()=>{
 const {readVolumeBreakoutResult}=await import('../src/services/volumeBreakoutEvidence.js');
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>Response.json({data:null});
  assert.equal((await readVolumeBreakoutResult('robinhood','0xtoken','0xpool')).reason,'SNAPSHOT_UNAVAILABLE');
  const p=structuredClone(payload);p.data.attributes.reserve_in_usd='500';
  globalThis.fetch=async()=>Response.json(p);
  assert.equal((await readVolumeBreakoutResult('robinhood','0xtoken','0xpool')).reason,'CONDITION_WAIT');
 }finally{globalThis.fetch=original;}
});

test('historical lookup reuses daily baseline, rejects HTTP errors and respects backoff',async()=>{
 const {readVolumeBreakout}=await import('../src/services/volumeBreakoutEvidence.js');
 const original=globalThis.fetch; let dailyCalls=0;
 const liveNow=Date.now(), b=Math.floor(liveNow/day)*day;
 const candles=Array.from({length:8},(_,i)=>[(b-(i+1)*day)/1000,1,2,0.5,1.1,i===0?15000:5000]);
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

test('diagnostics separate missing data, provider failure and valid nonqualifying market',async()=>{
 const {readVolumeBreakoutResult}=await import('../src/services/volumeBreakoutEvidence.js');
 assert.equal((await readVolumeBreakoutResult('unknown','token','pool')).reason,'INVALID_IDENTITY');
});
