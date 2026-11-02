import test from 'node:test';
import assert from 'node:assert/strict';
import type {EchoJupiterV2PreviewResult} from '../src/echo/readOnlyJupiterV2Swap.js';
import {runEchoAutoBuyReadOnlyTrial} from '../src/echo/autoBuyReadOnlyTrial.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint='GczSofuFAmwZkTXBaw9kpeo36Sven8q9fXDXmvUSpump';
const now=1793557000000;
const base={
 signal:{callerWallet:'5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',
  mint,amountSol:0.1,side:'BUY' as const,isVerifiedSwap:true,
  transactionSignature:'5qUsc7brjYRpmHLJbQcJMwBuB6PxuNmMwtZ1rCL7owz98sBs4FPEsT5p8RNqhbHFh4egvok4NPs1bncdTa4WeuP5'},
 executionWallet:wallet,rpcUrl:'https://example.org/',jupiterApiKey:'test-key',
 callerTradeAtMs:now-500,verifiedAtMs:now-250,
 tokenDecimals:9,tokenDecimalsVerified:true,callerEntryPriceSolPerToken:0.1,
 callerEntryPriceVerified:true,purchasedOrReservedMint:false,
 openOrPendingPositions:0,realizedLossSolToday:0,
 killSwitch:false,sellRouteVerified:true
};
const preview:EchoJupiterV2PreviewResult={
 ok:true,reason:'RPC_SIMULATION_SUCCEEDED',side:'BUY',
 inputMint:'So11111111111111111111111111111111111111112',
 outputMint:mint,inputRaw:'100000000',quotedOutputRaw:'1000000000',
 unsignedTransactionSha256:'a'.repeat(64),requestId:'fixture',
 logs:[],unitsConsumed:200000,
 unsignedAudit:{
  sha256:'a'.repeat(64),feePayer:wallet,staticAccounts:[wallet],
  writableAccounts:[wallet],programs:[],lookupTables:0,requiredSignatures:1,
  computeUnitLimit:220000,computeUnitPriceMicroLamports:'10000',
  worstCasePriorityFeeLamports:'2200',feeEstimateComplete:true,signingApproved:false
 }
};
const samples=Array.from({length:12},(_,i)=>({slot:467000000+i,prioritizationFee:1000+i*1000}));
function deps(o?:{clock?:()=>number;preview?:EchoJupiterV2PreviewResult;fees?:typeof samples}){
 let calls:string[]=[];
 const fetcher=(async(url:string)=>{
  calls.push(String(url));
  return new Response('{}',{status:200});
 }) as typeof fetch;
 const p=async(_request:any,f:typeof fetch)=>{
  await f('https://api.jup.ag/swap/v2/order?fixture=1',{method:'GET'});
  return o?.preview??preview;
 };
 const fee=async(_request:any)=>({
  samples:o?.fees??samples,rpcCalls:1 as const,readOnly:true as const,
  observedAtMs:now,writableAccountCount:1
 });
 return {deps:{clock:o?.clock??(()=>now),fetcher,
  preview:p as any,readFees:fee as any},calls};
}
test('actual measurement plumbing: 3 network calls at most; shadow candidate, never a transaction send',async()=>{
 const d=deps();
 const x=await runEchoAutoBuyReadOnlyTrial(base,d.deps);
 assert.equal(x.candidate,true);
 assert.equal(x.mode,'READ_ONLY_SHADOW');
 assert.equal(x.broadcast,false);assert.equal(x.signed,false);
 assert.equal(x.estimatedPriorityLamports,'1980');
 assert.equal(x.measuredComputeUnits,200000);
 assert.equal(x.verifiedQuotePriceSolPerToken,0.1);
 assert.equal(d.calls.length,1); // mock represents real Jupiter /order; fee mocked
 assert.ok(d.calls[0].includes('/swap/v2/order?'));
 assert.equal(d.calls.some(c=>/sendTransaction|execute/.test(c)),false);
});
test('duplicate, stale, daily loss and unknown decimals reject before any provider reads',async()=>{
 for(const input of [
  {...base,purchasedOrReservedMint:true},
  {...base,callerTradeAtMs:now-4000},
  {...base,realizedLossSolToday:0.15},
  {...base,tokenDecimalsVerified:false},
  {...base,sellRouteVerified:false}
 ]){
  const d=deps();const x=await runEchoAutoBuyReadOnlyTrial(input,d.deps);
  assert.equal(x.candidate,false);assert.equal(d.calls.length,0);
 }
});
test('failed real simulation and over-budget embedded priority fee reject',async()=>{
 const failed=deps({preview:{ok:false,reason:'SIMULATION_REJECTED'}});
 const r=await runEchoAutoBuyReadOnlyTrial(base,failed.deps);
 assert.equal(r.candidate,false);assert.equal(r.reason,'SIMULATION_REJECTED');
 const expensive=deps({preview:{...preview,unsignedAudit:{
  ...preview.unsignedAudit!,worstCasePriorityFeeLamports:'500001'}}});
 const e=await runEchoAutoBuyReadOnlyTrial(base,expensive.deps);
 assert.equal(e.reason,'ORDER_PRIORITY_FEE_CAP_EXCEEDED');
});
test('reject stale after quote building plus simulation, no fee sampler call',async()=>{
 let tick=now;
 let feeReads=0;
 const fetcher=(async()=>new Response('{}',{status:200})) as typeof fetch;
 const p=async(_request:any,f:typeof fetch)=>{
  await f('https://api.jup.ag/swap/v2/order?fixture=1',{method:'GET'});
  tick+=3200;return preview;
 };
 const x=await runEchoAutoBuyReadOnlyTrial(base,{
  fetcher,clock:()=>tick,preview:p as any,
  readFees:(async()=>{feeReads++;throw Error('not expected');}) as any
 });
 assert.equal(x.candidate,false);assert.equal(x.reason,'STALE_AFTER_REAL_SIMULATION');
 assert.equal(feeReads,0);
});
test('price premium and expensive localized fee cannot be overridden by shadow route',async()=>{
 const d=deps({fees:samples.map(s=>({...s,prioritizationFee:5_000_000}))});
 const x=await runEchoAutoBuyReadOnlyTrial(base,d.deps);
 assert.equal(x.reason,'OBSERVED_LANDING_FEE_EXCEEDS_BUDGET_SKIP_TRADE');
 const normal=deps();
 const inflated=await runEchoAutoBuyReadOnlyTrial({
  ...base,callerEntryPriceSolPerToken:0.06},normal.deps);
 assert.equal(inflated.candidate,false);
 assert.equal(inflated.reason,'PRICE_ALREADY_INFLATED');
});
test('absence of real provider credentials fails before any outbound request',async()=>{
 const d=deps();const x=await runEchoAutoBuyReadOnlyTrial({
  ...base,jupiterApiKey:''},d.deps);
 assert.equal(x.reason,'REAL_READ_ONLY_PROVIDER_ACCESS_REQUIRED');
 assert.equal(d.calls.length,0);
});
