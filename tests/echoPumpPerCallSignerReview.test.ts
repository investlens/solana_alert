import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createPrivateKey,sign as signEd25519} from 'node:crypto';
import bs58 from 'bs58';
import {Keypair,ComputeBudgetProgram,SystemProgram,PublicKey,
 TransactionMessage,TransactionInstruction,VersionedTransaction} from '@solana/web3.js';
import {SLINGOOR_WALLET} from '../src/echo/liveBuyPolicy.js';
import {canonicalEchoPerCallSignerRequest,perCallKey,
 type EchoPerCallSignerRequest} from '../src/echo/perCallSignerAdmissionV2.js';
import {reviewEchoPumpPerCallSignerNoBroadcast,
 ECHO_PUMP_SIGNER_REVIEW_CAN_SIGN,ECHO_PUMP_SIGNER_REVIEW_CAN_BROADCAST
} from '../src/echo/pumpPerCallSignerReview.js';
import type {EchoFiveDollarCall} from '../src/echo/fiveDollarCallPolicy.js';
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
 verifiedTokenCredit:true,isTransferOrGift:false,marketCapUsd:450000,
 callerPriceSolPerToken:0.00001,buyPriceSolPerToken:0.000014,
 maxSlippageBps:1000,observedAtMs:now-1000,nowMs:now,
 marketCapObservedAtMs:now,balanceVerifiedAtMs:now,solUsdObservedAtMs:now,
 principalLamports:String(principal),networkAndPriorityFeeLamports:'50000',
 accountRentLamports:'2000000',additionalCpiDebitLamports:'100000',
 sellReserveLamports:'2000000',pendingWalletDebitLamports:'0',
 availableWalletLamports:'100000000',solUsdPriceCents:'20000',
 exactMessageAndCpiAudited:true,manualSellRouteAndReserveVerified:true,
 walletBalanceAndFxVerified:true,durableReservationAvailable:true,
 killSwitch:false,openOrPendingLots:3,sourceTransactionAlreadyReserved:false
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
 positionClosedAt:null,transactionSignature:null
};
function input(){
 return {
  request,coordinatorSignatureBase58:signed(request),
  pinnedCoordinatorPublicKey:coordinator.publicKey.toBase58(),nowMs:now,
  unsignedTransactionBytes:bytes,
  nonceStore:{consumeOnce:async(_nonce:string,_exp:number)=>true},
  reservationReader:{getByCall:async()=>row},
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
