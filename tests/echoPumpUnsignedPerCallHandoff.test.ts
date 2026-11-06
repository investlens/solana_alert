import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair,ComputeBudgetProgram,SystemProgram,PublicKey,TransactionMessage,
 TransactionInstruction,VersionedTransaction} from '@solana/web3.js';
import {inspectPumpUnsignedPerCallHandoff,
 ECHO_PUMP_PER_CALL_HANDOFF_SIGNING_ENABLED,
 ECHO_PUMP_PER_CALL_HANDOFF_BROADCAST_ENABLED,
 type PumpUnsignedProbe,type PumpIndependentEvidence} from '../src/echo/pumpUnsignedPerCallHandoff.js';
import type {EchoPumpSizeInput} from '../src/echo/fiveDollarPumpInputSizing.js';
import {SLINGOOR_WALLET} from '../src/echo/liveBuyPolicy.js';
import type {EchoFiveDollarCall} from '../src/echo/fiveDollarCallPolicy.js';
const now=1800000000000;
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint=Keypair.generate().publicKey.toBase58();
const amount=20_000_000;
const msg=new TransactionMessage({
 payerKey:new PublicKey(wallet),recentBlockhash:Keypair.generate().publicKey.toBase58(),
 instructions:[
  ComputeBudgetProgram.setComputeUnitLimit({units:900000}),
  SystemProgram.transfer({fromPubkey:new PublicKey(wallet),
   toPubkey:Keypair.generate().publicKey,lamports:amount}),
  new TransactionInstruction({programId:new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'),
   keys:[],data:Buffer.from([1])})
 ]
}).compileToV0Message();
const tx=new VersionedTransaction(msg).serialize();
const hash=createHash('sha256').update(tx).digest('hex');
const call:EchoFiveDollarCall={
 executionWallet:wallet,callerWallet:SLINGOOR_WALLET,mint,sourceSignature:'2'.repeat(64),
 side:'BUY',verifiedCallerSigner:true,verifiedSwap:true,verifiedSpend:true,
 verifiedTokenCredit:true,isTransferOrGift:false,marketCapUsd:450000,
 callerPriceSolPerToken:0.00001,buyPriceSolPerToken:0.000013,
 maxSlippageBps:1000,observedAtMs:now-1000,nowMs:now,
 marketCapObservedAtMs:now,balanceVerifiedAtMs:now,solUsdObservedAtMs:now,
 principalLamports:String(amount),networkAndPriorityFeeLamports:'50000',
 accountRentLamports:'2000000',additionalCpiDebitLamports:'100000',
 sellReserveLamports:'2000000',pendingWalletDebitLamports:'0',
 availableWalletLamports:'100000000',solUsdPriceCents:'20000',
 exactMessageAndCpiAudited:true,manualSellRouteAndReserveVerified:true,
 walletBalanceAndFxVerified:true,durableReservationAvailable:true,
 killSwitch:false,openOrPendingLots:5,sourceTransactionAlreadyReserved:false
};
const probe:PumpUnsignedProbe={
 unsignedTransactionSha256:hash,unsignedConstructed:true,simulationPassed:true,
 quoteVerified:true,fullWalletDebitVerified:true,
 currentWalletLamports:100000000,networkBaseFeeLamports:50000,
 cpiRentAndExtraWalletDebitsAudited:true,amountLamports:amount,targetMint:mint
};
const independent:PumpIndependentEvidence={
 simulationMatchesExactBytes:true,allCpiAndRentDebitsIndependentlyAudited:true,
 manualPhantomSellReserveIndependentlyAudited:true,freshSolUsdAndBalanceVerified:true
};
const sizing:EchoPumpSizeInput={
 solUsdCents:call.solUsdPriceCents,
 networkAndPriorityFeeLamports:call.networkAndPriorityFeeLamports,
 ataAndOtherAccountRentLamports:call.accountRentLamports,
 maximumAdditionalCpiDebitLamports:call.additionalCpiDebitLamports,
 walletBalanceLamports:call.availableWalletLamports,
 pendingReservedLamports:call.pendingWalletDebitLamports,
 manualSellReserveLamports:call.sellReserveLamports,
 freshFxVerified:true,completeFeeAndCpiAudit:true,
 freshWalletBalanceVerified:true,manualSellReserveVerified:true
};
test('PumpSwap unsigned review only: matching exact message and per-call key, never signs',()=>{
 const result=inspectPumpUnsignedPerCallHandoff({caller:call,unsignedTxBytes:tx,probe,independent,sizing});
 assert.equal(result.ok,true);
 if(result.ok){
  assert.equal(result.fingerprint,hash);
  assert.equal(result.signerAllowed,false);
  assert.equal(result.broadcastAllowed,false);
  assert.equal(result.perCallReservationKey,[wallet,SLINGOOR_WALLET,call.sourceSignature,mint].join(':'));
 }
 assert.equal(ECHO_PUMP_PER_CALL_HANDOFF_SIGNING_ENABLED,false);
 assert.equal(ECHO_PUMP_PER_CALL_HANDOFF_BROADCAST_ENABLED,false);
});
test('actual unfunded/provisional Pump diagnostic must NEVER satisfy complete-debit handoff',()=>{
 const fromRealProbe={...probe,simulationPassed:false,fullWalletDebitVerified:false,
  cpiRentAndExtraWalletDebitsAudited:false,currentWalletLamports:0};
 const result=inspectPumpUnsignedPerCallHandoff({
  caller:call,unsignedTxBytes:tx,probe:fromRealProbe,independent,sizing});
 assert.deepEqual(result,{ok:false,reason:'INDEPENDENT_PUMP_SIMULATION_OR_FULL_DEBIT_NOT_VERIFIED',
  signerAllowed:false,broadcastAllowed:false});
});
test('changing bytes, mint, principal, fees and fund state fails closed',()=>{
 const cases=[
  {probe:{...probe,unsignedTransactionSha256:'a'.repeat(64)}},
  {probe:{...probe,targetMint:Keypair.generate().publicKey.toBase58()}},
  {probe:{...probe,amountLamports:25000000}},
  {probe:{...probe,networkBaseFeeLamports:50001}},
  {probe:{...probe,currentWalletLamports:0}},
  {independent:{...independent,simulationMatchesExactBytes:false}},
  {independent:{...independent,allCpiAndRentDebitsIndependentlyAudited:false}},
  {caller:{...call,marketCapUsd:500001}},
  {caller:{...call,sourceTransactionAlreadyReserved:true}},
  {sizing:{...sizing,maximumAdditionalCpiDebitLamports:'2000000'}},
  {sizing:{...sizing,completeFeeAndCpiAudit:false}}
 ];
 for(const change of cases){
  const result=inspectPumpUnsignedPerCallHandoff({
   caller:call,probe,independent,sizing,unsignedTxBytes:tx,...change});
  assert.equal(result.ok,false,JSON.stringify(change));
 }
});

test('split principal across two system transfers is rejected even when total matches',()=>{
 const split=new VersionedTransaction(new TransactionMessage({
  payerKey:new PublicKey(wallet),recentBlockhash:Keypair.generate().publicKey.toBase58(),
  instructions:[
   ComputeBudgetProgram.setComputeUnitLimit({units:900000}),
   SystemProgram.transfer({fromPubkey:new PublicKey(wallet),
    toPubkey:Keypair.generate().publicKey,lamports:amount/2}),
   SystemProgram.transfer({fromPubkey:new PublicKey(wallet),
    toPubkey:Keypair.generate().publicKey,lamports:amount/2}),
   new TransactionInstruction({programId:new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'),
    keys:[],data:Buffer.from([1])})
  ]
 }).compileToV0Message()).serialize();
 const splitHash=createHash('sha256').update(split).digest('hex');
 const result=inspectPumpUnsignedPerCallHandoff({
  caller:call,unsignedTxBytes:split,
  probe:{...probe,unsignedTransactionSha256:splitHash},independent,sizing
 });
 assert.deepEqual(result,{ok:false,reason:'PUMP_SWAP_OR_PRINCIPAL_MISMATCH',
  signerAllowed:false,broadcastAllowed:false});
});


test('malformed or duplicate compute-budget controls reject before signing',()=>{
 const amm=new TransactionInstruction({
  programId:new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'),
  keys:[],data:Buffer.from([1])
 });
 const transfer=SystemProgram.transfer({fromPubkey:new PublicKey(wallet),
  toPubkey:Keypair.generate().publicKey,lamports:amount});
 const cases=[
  {name:'duplicate compute limit',instructions:[
   ComputeBudgetProgram.setComputeUnitLimit({units:900000}),
   ComputeBudgetProgram.setComputeUnitLimit({units:900000}),transfer,amm]},
  {name:'duplicate priority price',instructions:[
   ComputeBudgetProgram.setComputeUnitPrice({microLamports:1000}),
   ComputeBudgetProgram.setComputeUnitPrice({microLamports:2000}),transfer,amm]},
  {name:'excessive compute limit',instructions:[
   ComputeBudgetProgram.setComputeUnitLimit({units:1400001}),transfer,amm]},
  {name:'zero compute limit',instructions:[
   ComputeBudgetProgram.setComputeUnitLimit({units:0}),transfer,amm]},
  {name:'unsupported heap control',instructions:[
   ComputeBudgetProgram.requestHeapFrame({bytes:32768}),transfer,amm]},
  {name:'bad account-bearing compute instruction',instructions:[
   new TransactionInstruction({programId:ComputeBudgetProgram.programId,
    keys:[{pubkey:new PublicKey(wallet),isSigner:false,isWritable:false}],
    data:Buffer.from([2,64,66,15,0])}),transfer,amm]}
 ];
 for(const c of cases){
  const unsigned=new VersionedTransaction(new TransactionMessage({
   payerKey:new PublicKey(wallet),
   recentBlockhash:Keypair.generate().publicKey.toBase58(),
   instructions:c.instructions
  }).compileToV0Message()).serialize();
  const h=createHash('sha256').update(unsigned).digest('hex');
  const result=inspectPumpUnsignedPerCallHandoff({
   caller:call,unsignedTxBytes:unsigned,
   probe:{...probe,unsignedTransactionSha256:h},
   independent,sizing
  });
  assert.equal(result.ok,false,c.name);
  assert.equal(result.signerAllowed,false,c.name);
  assert.equal(result.broadcastAllowed,false,c.name);
 }
});
