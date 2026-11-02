import test from 'node:test';
import assert from 'node:assert/strict';
import {createEchoManualSellReadOnlyHandler,
 ECHO_TELEGRAM_MANUAL_SELL_EXECUTION_ENABLED} from '../src/echo/manualSellReadOnlyCallback.js';
import type {EchoJupiterV2PreviewRequest,EchoJupiterV2PreviewResult}
 from '../src/echo/readOnlyJupiterV2Swap.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint='GczSofuFAmwZkTXBaw9kpeo36Sven8q9fXDXmvUSpump';
const now=1800000000000;
const position={wallet,mint,heldPositionConfirmed:true,tokenBalanceRaw:'100001',
 balanceObservedAtMs:now-100,existingSellReservation:false,tokenDecimals:6};
const callback={id:'cb-1',from:{id:123},
 message:{chat:{id:123}},data:'echo_preview:s50:'+mint};
const verifiedPreview=(r:EchoJupiterV2PreviewRequest):EchoJupiterV2PreviewResult=>({
 ok:true,reason:'RPC_SIMULATION_SUCCEEDED',side:r.side,
 inputMint:mint,outputMint:'So11111111111111111111111111111111111111112',
 inputRaw:r.amountRaw,quotedOutputRaw:'1000',requestId:'fixture',
 unsignedTransactionSha256:'a'.repeat(64),logs:[],unitsConsumed:100000,
 unsignedAudit:{feeEstimateComplete:true,feePayer:wallet} as any
});
function fixture(){
 const consumed=new Set<string>();
 const requests:EchoJupiterV2PreviewRequest[]=[];
 const handler=createEchoManualSellReadOnlyHandler({
  ownerChatId:'123',executionWallet:wallet,rpcUrl:'https://example.invalid',
  jupiterApiKey:'fixture-only',clock:()=>now,
  positionReader:{getPosition:async()=>position},
  replayStore:{consumeOnce:async id=>{
   if(consumed.has(id))return false;
   consumed.add(id);return true;}},
  preview:async req=>{requests.push(req);return verifiedPreview(req);}
 });
 return {handler,requests,consumed};
}
test('owner SELL 50% uses verified balance, 10% slippage and only nonbroadcast preview',async()=>{
 const f=fixture();const result=await f.handler(callback);
 assert.equal(result.accepted,true);
 assert.equal(result.mode,'READ_ONLY_NO_SIGNING');
 assert.equal(ECHO_TELEGRAM_MANUAL_SELL_EXECUTION_ENABLED,false);
 assert.equal(f.requests.length,1);
 assert.equal(f.requests[0].side,'SELL');
 assert.equal(f.requests[0].amountRaw,'50000');
 assert.equal(f.requests[0].maxSlippageBps,1000);
 const duplicate=await f.handler(callback);
 assert.equal(duplicate.reason,'DUPLICATE_CALLBACK');
 assert.equal(f.requests.length,1);
});
test('100% sell uses entire actual balance and does not turn on signing',async()=>{
 const f=fixture();const result=await f.handler({...callback,id:'cb-2',
  data:'echo_preview:s100:'+mint});
 assert.equal(result.accepted,true);assert.equal(f.requests[0].amountRaw,'100001');
});
test('outsider, group callback, BUY buttons and invalid wallet fail before any RPC',async()=>{
 const f=fixture();
 const bad=[
  {...callback,from:{id:456}},
  {...callback,message:{chat:{id:-123}}},
  {...callback,data:'echo_preview:b05:'+mint},
  {...callback,data:'echo_preview:s100:not-a-mint'}
 ];
 for(const b of bad)assert.equal((await f.handler(b)).accepted,false);
 assert.equal(f.requests.length,0);
});
test('stale balances, unverified position and pending sale are denied',async()=>{
 for(const changed of [
  {balanceObservedAtMs:now-2001},{heldPositionConfirmed:false},
  {existingSellReservation:true},{tokenBalanceRaw:'0'}
 ]){
  let requests=0,consumed=0;
  const handler=createEchoManualSellReadOnlyHandler({
   ownerChatId:'123',executionWallet:wallet,rpcUrl:'https://example.invalid',
   jupiterApiKey:'fixture',clock:()=>now,
   positionReader:{getPosition:async()=>({...position,...changed})},
   replayStore:{consumeOnce:async()=>{consumed++;return true;}},
   preview:async req=>{requests++;return verifiedPreview(req);}
  });
  assert.equal((await handler(callback)).accepted,false);
  assert.equal(requests,0);assert.equal(consumed,0);
 }
});
test('provider failure consumes callback and never retries it',async()=>{
 let calls=0;const ids=new Set<string>();
 const handler=createEchoManualSellReadOnlyHandler({
  ownerChatId:'123',executionWallet:wallet,rpcUrl:'https://example.invalid',
  jupiterApiKey:'fixture',clock:()=>now,
  positionReader:{getPosition:async()=>position},
  replayStore:{consumeOnce:async id=>{if(ids.has(id))return false;ids.add(id);return true;}},
  preview:async()=>{calls++;return {ok:false,reason:'RPC_SIMULATION_FAILED'};}
 });
 assert.equal((await handler(callback)).reason,'SELL_PREVIEW_RPC_SIMULATION_FAILED');
 assert.equal((await handler(callback)).reason,'DUPLICATE_CALLBACK');
 assert.equal(calls,1);
});
