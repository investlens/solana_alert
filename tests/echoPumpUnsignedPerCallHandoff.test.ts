import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair,ComputeBudgetProgram,SystemProgram,PublicKey,TransactionMessage,
 TransactionInstruction,VersionedTransaction} from '@solana/web3.js';
import {inspectPumpUnsignedPerCallHandoff,
 ECHO_PUMP_PER_CALL_HANDOFF_SIGNING_ENABLED,
 ECHO_PUMP_PER_CALL_HANDOFF_BROADCAST_ENABLED,
 type PumpUnsignedProbe,type PumpIndependentEvidence} from '../src/echo/pumpUnsignedPerCallHandoff.js';
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
test('PumpSwap unsigned review only: matching exact message and per-call key, never signs',()=>{
 const result=inspectPumpUnsignedPerCallHandoff({caller:call,unsignedTxBytes:tx,probe,independent});
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
  caller:call,unsignedTxBytes:tx,probe:fromRealProbe,independent});
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
  {caller:{...call,sourceTransactionAlreadyReserved:true}}
 ];
 for(const change of cases){
  const result=inspectPumpUnsignedPerCallHandoff({
   caller:call,probe,independent,unsignedTxBytes:tx,...change});
  assert.equal(result.ok,false,JSON.stringify(change));
 }
});
