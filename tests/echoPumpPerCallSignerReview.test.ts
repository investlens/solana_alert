import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createPrivateKey,sign as signEd25519} from 'node:crypto';
import bs58 from 'bs58';
import {Keypair,ComputeBudgetProgram,SystemProgram,PublicKey,
 TransactionMessage,TransactionInstruction,VersionedTransaction} from '@solana/web3.js';
import {SLINGOOR_WALLET} from '../src/echo/liveBuyPolicy.js';
import {canonicalEchoPerCallSignerRequest,perCallKey,
 type EchoPerCallSignerRequest,type EchoPerCallReservation} from '../src/echo/perCallSignerAdmissionV2.js';
import {reviewEchoPumpPerCallSignerNoBroadcast,
 ECHO_PUMP_SIGNER_REVIEW_CAN_SIGN,ECHO_PUMP_SIGNER_REVIEW_CAN_BROADCAST
} from '../src/echo/pumpPerCallSignerReview.js';
import type {EchoFiveDollarCall} from '../src/echo/fiveDollarCallPolicy.js';
import {screenEchoFiveDollarCall} from '../src/echo/fiveDollarCallPolicy.js';
import {prepareEchoPerCallNoBroadcast} from '../src/echo/perCallNoBroadcastCoordinator.js';
import {prepareEchoPumpNoBroadcastBridge,ECHO_PUMP_NO_BROADCAST_BRIDGE_CAN_BROADCAST}
 from '../src/echo/pumpNoBroadcastBridge.js';
import type {EchoPumpDebitEvidence} from '../src/echo/pumpSimulatedDebitEvidence.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const caller=SLINGOOR_WALLET,now=1800000000000;
const mint=Keypair.generate().publicKey.toBase58();
const coordinator=Keypair.generate();
const key=createPrivateKey({key:Buffer.concat([
 Buffer.from('302e020100300506032b657004220420','hex'),
 Buffer.from(coordinator.secretKey.slice(0,32))
]),format:'der',type:'pkcs8'});
const principal=20000000;
const bytes=new VersionedTransaction(new TransactionMessage({
 payerKey:new PublicKey(wallet),recentBlockhash:Keypair.generate().publicKey.toBase58(),
 instructions:[
  ComputeBudgetProgram.setComputeUnitLimit({units:900000}),
  SystemProgram.transfer({fromPubkey:new PublicKey(wallet),
   toPubkey:Keypair.generate().publicKey,lamports:principal}),
  new TransactionInstruction({programId:new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'),
   keys:[],data:Buffer.from([1])})
 ]
}).compileToV0Message()).serialize();
const sha=createHash('sha256').update(bytes).digest('hex');
const call:EchoFiveDollarCall={
 executionWallet:wallet,callerWallet:caller,mint,sourceSignature:'2'.repeat(64),
 side:'BUY',verifiedCallerSigner:true,verifiedSwap:true,verifiedSpend:true,
 verifiedTokenCredit:true,isTransferOrGift:false,marketCapUsd:45000,
 callerPriceSolPerToken:0.00001,buyPriceSolPerToken:0.000014,
 maxSlippageBps:1000,observedAtMs:now-1000,nowMs:now,
 marketCapObservedAtMs:now,balanceVerifiedAtMs:now,solUsdObservedAtMs:now,
 principalLamports:String(principal),networkAndPriorityFeeLamports:'50000',
 accountRentLamports:'2000000',additionalCpiDebitLamports:'100000',
 sellReserveLamports:'2000000',pendingWalletDebitLamports:'0',
 availableWalletLamports:'100000000',solUsdPriceCents:'20000',
 exactMessageAndCpiAudited:true,manualSellRouteAndReserveVerified:true,
 walletBalanceAndFxVerified:true,durableReservationAvailable:true,
 killSwitch:false,openOrPendingLots:0,sourceTransactionAlreadyReserved:false
};
const probe={
 unsignedTransactionSha256:sha,unsignedConstructed:true,simulationPassed:true,
 quoteVerified:true,fullWalletDebitVerified:true,currentWalletLamports:100000000,
 networkBaseFeeLamports:50000,cpiRentAndExtraWalletDebitsAudited:true,
 amountLamports:principal,targetMint:mint
};
const independent={
 simulationMatchesExactBytes:true,allCpiAndRentDebitsIndependentlyAudited:true,
 manualPhantomSellReserveIndependentlyAudited:true,freshSolUsdAndBalanceVerified:true
};
const sizing={
 solUsdCents:'20000',networkAndPriorityFeeLamports:'50000',
 ataAndOtherAccountRentLamports:'2000000',
 maximumAdditionalCpiDebitLamports:'100000',walletBalanceLamports:'100000000',
 pendingReservedLamports:'0',manualSellReserveLamports:'2000000',
 freshFxVerified:true,completeFeeAndCpiAudit:true,
 freshWalletBalanceVerified:true,manualSellReserveVerified:true
};
const debitEvidence:EchoPumpDebitEvidence={
 unsignedBytes:bytes,
 simulatedUnsignedSha256:sha,
 simulationSucceeded:true,
 simulationSignatureVerificationDisabled:true,
 actualWalletBalanceBeforeLamports:'100000000',
 simulatedWalletBalanceAfterLamports:'79950000',
 independentlyObservedNetworkFeeLamports:'50000',
 reservedAccountRentLamports:'2000000',
 independentlyBoundedAdditionalCpiLamports:'100000',
 exitReserveLamports:'2000000',
 pendingReservedLamports:'0',solUsdCents:'20000',
 observedAtMs:now,nowMs:now
};
const request:EchoPerCallSignerRequest={
 audience:'echo-isolated-signer',action:'BUY',
 executionWallet:wallet,callerWallet:caller,mint,sourceSignature:call.sourceSignature,
 reservationKey:perCallKey(call),transactionSha256:sha,
 nonceHex:'f'.repeat(64),issuedAtMs:now-100,expiresAtMs:now+10000
};
const signed=(r:EchoPerCallSignerRequest)=>
 bs58.encode(signEd25519(null,Buffer.from(canonicalEchoPerCallSignerRequest(r)),key));
const row={
 executionWallet:wallet,callerWallet:caller,mint,
 sourceSignature:call.sourceSignature,state:'reserved',
 amountLamports:principal,allInCents:443,
 exactFeeLamports:50000,accountRentLamports:2000000,
 cpiExtraLamports:100000,allInLamports:22150000,sellReserveLamports:2000000,
 positionClosedAt:null,transactionSignature:null
};
function input(){
 return {
  request,coordinatorSignatureBase58:signed(request),
  pinnedCoordinatorPublicKey:coordinator.publicKey.toBase58(),nowMs:now,
  unsignedTransactionBytes:bytes,
  nonceStore:{consumeOnce:async(_nonce:string,_exp:number)=>true},
  reservationReader:{getByCall:async():Promise<EchoPerCallReservation>=>row},
  evidenceReader:{readFromTrustedProviders:async()=>({call,probe,independent,sizing,debitEvidence})}
 };
}
test('authenticated synthetic per-call PumpSwap review stays no-sign/no-broadcast',async()=>{
 const seen=new Set<string>();
 const x=input();
 x.nonceStore.consumeOnce=async(n:string)=>{
  if(seen.has(n))return false;seen.add(n);return true;
 };
 const ok=await reviewEchoPumpPerCallSignerNoBroadcast(x);
 assert.deepEqual(ok,{ok:true,mode:'PUMP_PER_CALL_REVIEW_ONLY',
  unsignedSha256:sha,reservationKey:request.reservationKey,
  signingAllowed:false,broadcastAllowed:false});
 const again=await reviewEchoPumpPerCallSignerNoBroadcast(x);
 assert.deepEqual(again,{ok:false,reason:'NONCE_ALREADY_CONSUMED',
  signingAllowed:false,broadcastAllowed:false});
 assert.equal(ECHO_PUMP_SIGNER_REVIEW_CAN_SIGN,false);
 assert.equal(ECHO_PUMP_SIGNER_REVIEW_CAN_BROADCAST,false);
});
test('source signature, token mint and signed message tampering reject before trusted reads',async()=>{
 let reads=0;
 const x=input();
 x.reservationReader.getByCall=async()=>{reads++;return row;};
 for(const patch of [
  {sourceSignature:'3'.repeat(64)},
  {mint:Keypair.generate().publicKey.toBase58()},
  {reservationKey:wallet+':'+mint},
  {transactionSha256:'a'.repeat(64)},
  {callerWallet:Keypair.generate().publicKey.toBase58()}
 ]){
  const out=await reviewEchoPumpPerCallSignerNoBroadcast({
   ...x,request:{...request,...patch}});
  assert.equal(out.ok,false,JSON.stringify(patch));
 }
 assert.equal(reads,0);
});
test('reserved USD amount must match independently audited transaction debit',async()=>{
 let consumed=0;
 const x=input();
 x.reservationReader.getByCall=async()=>({...row,allInCents:442});
 x.nonceStore.consumeOnce=async()=>{consumed++;return true;};
 const result=await reviewEchoPumpPerCallSignerNoBroadcast(x);
 assert.deepEqual(result,{ok:false,reason:'PUMP_RESERVED_USD_DEBIT_MISMATCH',
  signingAllowed:false,broadcastAllowed:false});
 assert.equal(consumed,0);
});
test('Postgres bigint decimal strings pass exact reserved-cost matching',async()=>{
 const x=input();
 x.reservationReader.getByCall=async()=>({
  ...row,
  amountLamports:String(row.amountLamports),
  allInCents:String(row.allInCents),
  exactFeeLamports:String(row.exactFeeLamports),
  accountRentLamports:String(row.accountRentLamports),
  cpiExtraLamports:String(row.cpiExtraLamports),
  allInLamports:String(row.allInLamports),
  sellReserveLamports:String(row.sellReserveLamports)
 });
 const result=await reviewEchoPumpPerCallSignerNoBroadcast(x);
 assert.equal(result.ok,true,JSON.stringify(result));
 if(result.ok){
  assert.equal(result.signingAllowed,false);
  assert.equal(result.broadcastAllowed,false);
 }
});
test('unsafe rounded JS bigint and malformed decimal database amounts reject',async()=>{
 let consumed=0;
 for(const altered of [
  {allInLamports:Number.MAX_SAFE_INTEGER+1},
  {allInLamports:'022150000'},
  {amountLamports:'20000000.5'},
  {exactFeeLamports:'-1'},
  {allInCents:'500.0'}
 ]){
  const x=input();
  x.reservationReader.getByCall=async()=>({...row,...altered});
  x.nonceStore.consumeOnce=async()=>{consumed++;return true;};
  const result=await reviewEchoPumpPerCallSignerNoBroadcast(x);
  assert.equal(result.ok,false,JSON.stringify(altered));
 }
 assert.equal(consumed,0);
});
test('immutable fee, rent, CPI and sell-reserve mismatches reject before nonce',async()=>{
 let consumed=0;
 for(const modified of [
  {exactFeeLamports:49999},
  {accountRentLamports:1999999},
  {cpiExtraLamports:0},
  {allInLamports:22149999},
  {sellReserveLamports:1999999},
  {exactFeeLamports:undefined}
 ]){
  const x=input();
  x.reservationReader.getByCall=async()=>({...row,...modified});
  x.nonceStore.consumeOnce=async()=>{consumed++;return true;};
  const result=await reviewEchoPumpPerCallSignerNoBroadcast(x);
  assert.deepEqual(result,{ok:false,reason:'PUMP_RESERVED_COST_COMPONENTS_MISMATCH',
   signingAllowed:false,broadcastAllowed:false});
 }
 assert.equal(consumed,0);
});
test('unknown CPI, unfunded wallet, wrong lot and failed independent simulation reject without nonce',async()=>{
 let consumed=0;
 const x=input();
 const bads=[
  {...x,reservationReader:{getByCall:async()=>({...row,amountLamports:principal+1})}},
  {...x,evidenceReader:{readFromTrustedProviders:async()=>({call,probe:{...probe,simulationPassed:false},independent,sizing})}},
  {...x,evidenceReader:{readFromTrustedProviders:async()=>({call,probe:{...probe,currentWalletLamports:0},independent,sizing})}},
  {...x,evidenceReader:{readFromTrustedProviders:async()=>({call,probe,independent:{...independent,allCpiAndRentDebitsIndependentlyAudited:false},sizing})}},
  {...x,evidenceReader:{readFromTrustedProviders:async()=>({call,probe,independent,sizing,debitEvidence:{...debitEvidence,simulationSucceeded:false}})}},
  {...x,evidenceReader:{readFromTrustedProviders:async()=>({call,probe,independent,sizing,debitEvidence:{...debitEvidence,simulatedWalletBalanceAfterLamports:'79900000'}})}},
  {...x,evidenceReader:{readFromTrustedProviders:async()=>null}}
 ];
 for(const b of bads){
  const out=await reviewEchoPumpPerCallSignerNoBroadcast({
   ...b,nonceStore:{consumeOnce:async()=>{consumed++;return true;}}
  });
  assert.equal(out.ok,false);
  assert.equal(out.signingAllowed,false);
 }
 assert.equal(consumed,0);
});

test('existing lots are allowed when independently reserved exit costs and available SOL are verified',async()=>{
 const x=input();let nonceConsumed=0;
 x.evidenceReader.readFromTrustedProviders=async()=>({
  call:{...call,openOrPendingLots:2},probe,independent,sizing,debitEvidence
 });
 x.nonceStore.consumeOnce=async()=>{nonceConsumed++;return true;};
 const result=await reviewEchoPumpPerCallSignerNoBroadcast(x);
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(result.signingAllowed,false);
 assert.equal(result.broadcastAllowed,false);
 assert.equal(nonceConsumed,1);
});

test('synthetic caller -> atomic reservation -> authenticated signer review is no-broadcast and replay-safe',async()=>{
 const captured:string[]=[];
 let reserved=false;
 let consumed=0;
 const nonces=new Set<string>();
 const source={getVerifiedBuyAndQuote:async()=>({
  call,chainAtMs:now-1000,websocketObservedAtMs:now-700,verifiedAtMs:now-300
 })};
 const result=await prepareEchoPerCallNoBroadcast({
  source,
  store:{reserve:async(candidate:EchoFiveDollarCall)=>{
   const decision=screenEchoFiveDollarCall(candidate);
   assert.equal(decision.eligible,true);
   if(!decision.eligible)throw Error('invalid candidate');
   reserved=true;captured.push(decision.intentKey);
   return {reserved:true as const,key:decision.intentKey,executable:false as const};
  }},
  now:()=>now,manualAutoBuyEnabled:true
 });
 assert.equal(result.reserved,true);
 assert.equal(result.executable,false);
 assert.equal(result.broadcastAllowed,false);
 assert.equal(result.timing?.submittedAtMs,null);
 assert.equal(result.timing?.signedAtMs,null);
 assert.equal(result.timing?.chainToReservedMs,1000);
 assert.equal(reserved,true);
 assert.deepEqual(captured,[request.reservationKey]);
 const x=input();
 x.reservationReader.getByCall=async(w,sig)=>{
  assert.equal(w,wallet);
  assert.equal(sig,request.sourceSignature);
  return reserved?row:null;
 };
 x.nonceStore.consumeOnce=async(nonce:string)=>{
  consumed++;
  if(nonces.has(nonce))return false;
  nonces.add(nonce);return true;
 };
 const first=await reviewEchoPumpPerCallSignerNoBroadcast(x);
 assert.equal(first.ok,true,JSON.stringify(first));
 assert.equal(first.signingAllowed,false);
 assert.equal(first.broadcastAllowed,false);
 const second=await reviewEchoPumpPerCallSignerNoBroadcast(x);
 assert.deepEqual(second,{
  ok:false,reason:'NONCE_ALREADY_CONSUMED',
  signingAllowed:false,broadcastAllowed:false
 });
 assert.equal(consumed,2);
 // This test does not use a real RPC, production DB, wallet key or broadcaster.
});

test('integrated no-broadcast bridge binds one verified caller to signer and never sends',async()=>{
 let reserveCalls=0;
 let evidenceReads=0;
 const x=input();
 const observation={call,chainAtMs:now-1000,websocketObservedAtMs:now-700,verifiedAtMs:now-300};
 const result=await prepareEchoPumpNoBroadcastBridge({
  source:{getVerifiedBuyAndQuote:async()=>observation},
  store:{reserve:async(c)=>{reserveCalls++;
   assert.equal(c.sourceSignature,request.sourceSignature);
   return {reserved:true as const,key:request.reservationKey,executable:false as const};
  }},
  now:()=>now,manualAutoBuyEnabled:true,
  unsignedTransactionBytes:bytes,signerRequest:request,
  coordinatorSignatureBase58:signed(request),
  pinnedCoordinatorPublicKey:coordinator.publicKey.toBase58(),
  nonceStore:x.nonceStore,reservationReader:x.reservationReader,
  evidenceReader:{readFromTrustedProviders:async()=>{evidenceReads++;
   return {call,probe,independent,sizing,debitEvidence};}}
 });
 assert.equal(result.status,'REVIEWED_NO_BROADCAST',JSON.stringify(result));
 assert.equal(result.reservation?.reserved,true);
 assert.equal(result.signer?.ok,true);
 assert.equal(result.canSign,false);
 assert.equal(result.canBroadcast,false);
 assert.equal(ECHO_PUMP_NO_BROADCAST_BRIDGE_CAN_BROADCAST,false);
 assert.equal(reserveCalls,1);
 assert.equal(evidenceReads,1);
});

test('bridge owner OFF, tampered bytes and cross-source mismatch do not reserve',async()=>{
 let sourceReads=0,reserveCalls=0,signerReads=0;
 const x=input();
 const source={getVerifiedBuyAndQuote:async()=>{sourceReads++;
  return {call,chainAtMs:now-1000,websocketObservedAtMs:now-700,verifiedAtMs:now-300};}};
 const store={reserve:async()=>{reserveCalls++;throw Error('unexpected reserve');}};
 const base={
  source,store,now:()=>now,manualAutoBuyEnabled:true,
  unsignedTransactionBytes:bytes,signerRequest:request,
  coordinatorSignatureBase58:signed(request),
  pinnedCoordinatorPublicKey:coordinator.publicKey.toBase58(),
  nonceStore:x.nonceStore,reservationReader:x.reservationReader,
  evidenceReader:{readFromTrustedProviders:async()=>{signerReads++;return null;}}
 };
 const off=await prepareEchoPumpNoBroadcastBridge({...base,manualAutoBuyEnabled:false});
 assert.equal(off.reason,'OWNER_AUTO_BUY_OFF');
 const tampered=Uint8Array.from(bytes);tampered[tampered.length-1]^=1;
 const badBytes=await prepareEchoPumpNoBroadcastBridge({
  ...base,unsignedTransactionBytes:tampered});
 assert.equal(badBytes.reason,'UNTRUSTED_UNSIGNED_MESSAGE_OR_SIGNER_REQUEST');
 const foreign=await prepareEchoPumpNoBroadcastBridge({
  ...base,signerRequest:{...request,sourceSignature:'3'.repeat(64),
   reservationKey:[wallet,caller,'3'.repeat(64),mint].join(':')}
 });
 assert.equal(foreign.reason,'CALLER_SOURCE_SIGNER_IDENTITY_MISMATCH');
 assert.equal(sourceReads,1);
 assert.equal(reserveCalls,0);
 assert.equal(signerReads,0);
});
