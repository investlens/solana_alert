import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,type ParsedTransactionWithMeta}
 from '@solana/web3.js';
import {reviewIntegratedEchoPumpBuy,
 ECHO_INTEGRATED_PUMP_CAN_BROADCAST}
 from '../src/echo/integratedPumpTradeAdmission.js';
import {SLINGOOR_WALLET} from '../src/echo/liveBuyPolicy.js';
import type {EchoSignal} from '../src/echo/signals.js';
import type {EchoPumpBridgeInput} from '../src/echo/pumpNoBroadcastBridge.js';
const now=1800000000000;
const signature='2'.repeat(64);
const mint=Keypair.generate().publicKey.toBase58();
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const signal:EchoSignal={id:signature+':'+mint,
 signature,wallet:SLINGOOR_WALLET,caller:'WHALE · slingoor',
 timestamp:now/1000-1,mint,side:'BUY',tokenAmount:2000,
 quoteAmount:0.01,quoteSymbol:'SOL',quoteBasis:'token-account net change'};
const receipt=(signed=true)=>({
 slot:500,
 transaction:{message:{accountKeys:[{
  pubkey:new PublicKey(SLINGOOR_WALLET),signer:signed,writable:true}]}},
 meta:{err:null,preTokenBalances:[{
  accountIndex:3,mint,owner:SLINGOOR_WALLET,
  uiTokenAmount:{amount:'1000'}}],postTokenBalances:[{
  accountIndex:3,mint,owner:SLINGOOR_WALLET,
  uiTokenAmount:{amount:'3000'}}]}
}) as unknown as ParsedTransactionWithMeta;
const stubBridge=()=>({
 signerOwnedPoolPreflight:{
  targetMint:mint,connection:{} as any,sdkDerivedPools:[] as string[]
 },
 signerOwnedOfficialQuotePreflight:{
  rpc:{} as any,sdk:{} as any,firstPool:mint,secondPool:mint,
  intermediateMint:mint
 },
 signerRequest:{executionWallet:wallet,callerWallet:SLINGOOR_WALLET,
  sourceSignature:signature,mint,
  reservationKey:[wallet,SLINGOOR_WALLET,signature,mint].join(':')}
}) as unknown as EchoPumpBridgeInput;
function setUp(){
 let receiptReads=0,quoteReads=0;
 const input={
  signal,now:()=>now,websocketObservedAtMs:now-400,
  historicalReplay:false,
  ownerAutoBuyEnabled:async()=>true,
  callerRpc:{getParsedTransaction:async()=>{
   receiptReads++;return receipt();}},
  trustedProvider:{readIndependentlyVerifiedCall:async()=>{
   quoteReads++;return null;}},
  bridge:stubBridge()
 };
 return {input,counters:()=>({receiptReads,quoteReads})};
}
test('owner sleep OFF blocks before all RPC, queue and signer reads',async()=>{
 const {input,counters}=setUp();
 const r=await reviewIntegratedEchoPumpBuy({
  ...input,ownerAutoBuyEnabled:async()=>false
 });
 assert.equal(r.reason,'OWNER_AUTO_BUY_OFF');
 assert.deepEqual(counters(),{receiptReads:0,quoteReads:0});
 assert.equal(r.canSign,false);assert.equal(r.canBroadcast,false);
 assert.equal(ECHO_INTEGRATED_PUMP_CAN_BROADCAST,false);
});
test('quote provider and both signer-owned preflights are mandatory',async()=>{
 const {input,counters}=setUp();
 const missingProvider=await reviewIntegratedEchoPumpBuy({
  ...input,trustedProvider:null
 });
 assert.equal(missingProvider.reason,'TRUSTED_ECONOMICS_PROVIDER_NOT_CONNECTED');
 const missingPreflight=await reviewIntegratedEchoPumpBuy({
  ...input,bridge:null
 });
 assert.equal(missingPreflight.reason,'SIGNER_OWNED_PUMPSWAP_PREFLIGHT_REQUIRED');
 assert.deepEqual(counters(),{receiptReads:0,quoteReads:0});
});
test('independent transaction must really be signed by caller before quotes',async()=>{
 const {input,counters}=setUp();
 const r=await reviewIntegratedEchoPumpBuy({
  ...input,callerRpc:{getParsedTransaction:async()=>receipt(false)}
 });
 assert.equal(r.reason,'INDEPENDENT_RECEIPT_TRACKED_CALLER_DID_NOT_SIGN');
 assert.equal(r.canBroadcast,false);
 assert.equal(counters().quoteReads,0);
});
test('valid source signature and token credit cannot replace missing economic proof',async()=>{
 const {input,counters}=setUp();
 const r=await reviewIntegratedEchoPumpBuy(input);
 assert.equal(r.reason,'TRUSTED_PUMP_PROVIDER_UNAVAILABLE'===r.reason?
  'TRUSTED_PUMP_PROVIDER_UNAVAILABLE': 'TRUSTED_CALLER_QUOTE_IDENTITY_MISMATCH');
 assert.equal(r.canSign,false);assert.equal(r.canBroadcast,false);
 assert.deepEqual(counters(),{receiptReads:1,quoteReads:1});
});
test('historical replay never tries a read-only RPC',async()=>{
 const {input,counters}=setUp();
 const r=await reviewIntegratedEchoPumpBuy({
  ...input,historicalReplay:true
 });
 assert.equal(r.reason,'HISTORICAL_REPLAY_NOT_TRADABLE');
 assert.deepEqual(counters(),{receiptReads:0,quoteReads:0});
});
