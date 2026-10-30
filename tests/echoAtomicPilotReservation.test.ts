import test from 'node:test';
import assert from 'node:assert/strict';
import { SLINGOOR_WALLET,CHAIRMAN_WALLET } from '../src/echo/liveBuyPolicy.js';
import { reserveEchoTenDollarPilot, type EchoAtomicPositionStore } from '../src/echo/atomicPilotReservation.js';
const now=1800000000000, wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const order={callerWallet:SLINGOOR_WALLET,mint:'So11111111111111111111111111111111111111112',
 verifiedBuyerSigner:true,originalSwapSucceeded:true,verifiedSpend:true,verifiedTokenCredit:true,
 priceSolUsd:200,priceObservedAtMs:now,nowMs:now,spentOrdersToday:0,
 openOrPendingPositions:0,openOrPendingPrincipalUsd:0,
 alreadyReservedOrPurchased:false,killSwitchEngaged:false,maxFeeLamports:500000};
test('atomic store admits only two concurrent $10 caller buys',async()=>{
 let current=Promise.resolve(), count=0, calls=0;
 const seen=new Set<string>();
 const store:EchoAtomicPositionStore={reserveIfCapacity(lease){
  const p=current.then(()=>{
   calls++;
   const key=lease.executionWallet+':'+lease.mint;
   if(seen.has(key))return {reserved:false as const,reason:'DUPLICATE_TOKEN' as const};
   if(count>=2)return {reserved:false as const,reason:'TWO_SLOTS_FULL' as const};
   seen.add(key);count++;
   return {reserved:true as const,key};
  });
  current=p.then(()=>{},()=>{});
  return p;
 }};
 const mints=['So11111111111111111111111111111111111111112','4'.repeat(44),'5'.repeat(44)];
 const signals=mints.map((mint,i)=>reserveEchoTenDollarPilot(
  {...order,mint,callerWallet:i===1?CHAIRMAN_WALLET:SLINGOOR_WALLET},
  wallet,String(i+3).repeat(64),store));
 const results=await Promise.all(signals);
 assert.deepEqual(results.map(r=>r.reserved),[true,true,false]);
 assert.equal(count,2);assert.equal(calls,3);
 const repeat=await reserveEchoTenDollarPilot(order,wallet,'3'.repeat(64),store);
 assert.equal(repeat.reserved,false);
});
test('database errors fail closed without trading',async()=>{
 const store:EchoAtomicPositionStore={reserveIfCapacity:async()=>{throw Error('db unavailable');}};
 assert.deepEqual(await reserveEchoTenDollarPilot(order,wallet,'3'.repeat(64),store),
  {reserved:false,reason:'DATABASE_UNAVAILABLE'});
});
