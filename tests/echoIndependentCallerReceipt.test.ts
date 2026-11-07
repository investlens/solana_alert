import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,type ParsedTransactionWithMeta} from '@solana/web3.js';
import {verifyEchoCallerReceipt,
 ECHO_CALLER_RECEIPT_CAN_BROADCAST} from '../src/echo/independentCallerReceipt.js';
import {SLINGOOR_WALLET} from '../src/echo/liveBuyPolicy.js';
import {inspectIndependentlyVerifiedLiveCaller}
 from '../src/echo/liveCallerPumpQuoteIngress.js';
import type {EchoSignal} from '../src/echo/signals.js';
const mint=Keypair.generate().publicKey.toBase58();
const signature='2'.repeat(64),now=1800000000000;
const tx=(signed=true,credit='3000',err:null|object=null)=>
 ({
  slot:120,
  transaction:{message:{accountKeys:[{
   pubkey:new PublicKey(SLINGOOR_WALLET),signer:signed,writable:true
  }]}},
  meta:{err,preTokenBalances:[{
   accountIndex:3,mint,owner:SLINGOOR_WALLET,
   uiTokenAmount:{amount:'1000'}
  }],postTokenBalances:[{
   accountIndex:3,mint,owner:SLINGOOR_WALLET,
   uiTokenAmount:{amount:credit}
  }]}
 }) as unknown as ParsedTransactionWithMeta;
const src=(r:ParsedTransactionWithMeta|null)=>({
 getParsedTransaction:async()=>r
});
const args={callerWallet:SLINGOOR_WALLET,sourceSignature:signature,mint};
test('independently re-read on-chain signer and caller token balance',async()=>{
 const r=await verifyEchoCallerReceipt({...args,rpc:src(tx())});
 assert.equal(r.ok,true,JSON.stringify(r));
 if(r.ok){
  assert.equal(r.receivedRaw,'2000');
  assert.equal(r.feeAndSwapDebitProven,false);
  assert.equal(r.marketCapVerified,false);
  assert.equal(r.canSign,false);
  assert.equal(r.canBroadcast,false);
 }
 assert.equal(ECHO_CALLER_RECEIPT_CAN_BROADCAST,false);
});
test('unsigned wallet, missing token credit, failed or absent transaction reject',async()=>{
 for(const suspect of [tx(false),tx(true,'1000'),tx(true,'900'),
   tx(true,'3000',{InstructionError:[0,'Custom']}),null]){
  const r=await verifyEchoCallerReceipt({...args,rpc:src(suspect)});
  assert.equal(r.ok,false,JSON.stringify(r));
  assert.equal(r.canBroadcast,false);
 }
});
test('unknown caller and spoofed mint fail before the pinned RPC',async()=>{
 let calls=0;
 const rpc={getParsedTransaction:async()=>{calls++;return tx();}};
 const unknown=await verifyEchoCallerReceipt({...args,rpc,
  callerWallet:Keypair.generate().publicKey.toBase58()});
 const wrong=await verifyEchoCallerReceipt({...args,rpc,mint:'bad'});
 assert.equal(unknown.ok,false);assert.equal(wrong.ok,false);
 assert.equal(calls,0);
});
test('release ingress denies forged receipt before trusting a separate quote provider',async()=>{
 let quoteReads=0;
 const signal:EchoSignal={id:signature+':'+mint,signature,
  wallet:SLINGOOR_WALLET,caller:'WHALE · slingoor',
  timestamp:now/1000-1,mint,side:'BUY',tokenAmount:2000,
  quoteAmount:0.01,quoteSymbol:'SOL',quoteBasis:'token-account net change'};
 const out=await inspectIndependentlyVerifiedLiveCaller({
  signal,nowMs:now,verifiedAtMs:now,
  websocketObservedAtMs:now-400,historicalReplay:false,
  rpc:src(tx(false)),provider:{readIndependentlyVerifiedCall:async()=>{
   quoteReads++;return null;
  }}
 });
 assert.equal(out.reason,'INDEPENDENT_RECEIPT_TRACKED_CALLER_DID_NOT_SIGN');
 assert.equal(quoteReads,0);assert.equal(out.canBroadcast,false);
});
test('positive caller receipt still blocks without independent Pump quote and SELL proof',async()=>{
 const signal:EchoSignal={id:signature+':'+mint,signature,
  wallet:SLINGOOR_WALLET,caller:'WHALE · slingoor',
  timestamp:now/1000-1,mint,side:'BUY',tokenAmount:2000,
  quoteAmount:0.01,quoteSymbol:'SOL',quoteBasis:'token-account net change'};
 const out=await inspectIndependentlyVerifiedLiveCaller({
  signal,nowMs:now,verifiedAtMs:now,
  websocketObservedAtMs:now-400,historicalReplay:false,
  rpc:src(tx()),provider:null
 });
 assert.equal(out.reason,'TRUSTED_PUMP_PROVIDER_NOT_CONNECTED');
 assert.equal(out.canBroadcast,false);
});
