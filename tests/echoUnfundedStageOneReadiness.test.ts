import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ComputeBudgetProgram,Keypair,PublicKey,TransactionMessage,VersionedTransaction}
 from '@solana/web3.js';
import {assessEchoUnfundedStageOne,ECHO_UNFUNDED_STAGE_ONE_CAN_FUND}
 from '../src/echo/unfundedStageOneReadiness.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const tx=new VersionedTransaction(new TransactionMessage({
 payerKey:new PublicKey(wallet),recentBlockhash:Keypair.generate().publicKey.toBase58(),
 instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:500000})]
}).compileToV0Message()).serialize();
const sha=createHash('sha256').update(tx).digest('hex');
function input(){return {
 unsignedBytes:tx,expectedSha256:sha,expectedMint:Keypair.generate().publicKey.toBase58(),
 exactProtocolAccountsIndependentlyVerified:true,
 allCpiEffectsIndependentlyDecoded:true,
 exactFeeAndPriorityQuoteVerified:true,rentAndTokenAccountOwnersVerified:true,
 independentManualExitQuoteAndReserveVerified:true,
 signerNoBroadcastIntegrationPassed:true,atomicDatabaseConcurrencyPassed:true,
 currentCiPassed:true,
 funding:{principalLamports:'20000000',networkFeeLamports:'50000',
  absentAtaCount:1,maxAtaRentPerAccountLamports:'2000000',
  walletBalanceLamports:'100000000',extraCpiDebitUpperBoundLamports:'100000',
  manualSellExitReserveLamports:'3000000',pendingReservedDebitsLamports:'0',
  solUsdCents:'20000',fullPumpCpiAndRentAudited:true,
  manualSellSimulationVerified:true}
};}
test('even complete synthetic evidence never grants funding, signing or broadcasting',()=>{
 const r=assessEchoUnfundedStageOne(input());
 assert.equal(r.completed,true);
 assert.equal(r.status,'UNFUNDED_STAGE_ONE_REVIEWED');
 assert.equal(r.fullyVerifiedFundingRequirementLamports,'25150000');
 assert.equal(r.canFund,false);assert.equal(r.canSign,false);
 assert.equal(r.canBroadcast,false);assert.equal(ECHO_UNFUNDED_STAGE_ONE_CAN_FUND,false);
});
test('real-world missing CPI, exit, CI and quote cannot produce funding requirement',()=>{
 const x=input();x.allCpiEffectsIndependentlyDecoded=false;
 x.independentManualExitQuoteAndReserveVerified=false;
 x.currentCiPassed=false;x.funding.fullPumpCpiAndRentAudited=false;
 x.funding.manualSellSimulationVerified=false;
 const r=assessEchoUnfundedStageOne(x);
 assert.equal(r.completed,false);
 assert.equal(r.fullyVerifiedFundingRequirementLamports,null);
 assert.ok(r.missing.includes('INDEPENDENT_FULL_CPI_AND_TOKEN_BALANCE_PROVENANCE'));
 assert.ok(r.missing.includes('CURRENT_COMMIT_CI_PASS'));
 assert.ok(r.missing.includes('FULLY_BOUNDED_FUNDING_ENVELOPE'));
 assert.equal(r.provisionalUnsignedAttemptFloorLamports,'22050000');
});
test('modified unsigned bytes or foreign signer fail closed before funding',()=>{
 const modified=Uint8Array.from(tx);modified[modified.length-1]^=1;
 for(const unsignedBytes of [
  modified,
  new VersionedTransaction(new TransactionMessage({
   payerKey:Keypair.generate().publicKey,
   recentBlockhash:Keypair.generate().publicKey.toBase58(),
   instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:500000})]
  }).compileToV0Message()).serialize()
 ]){
  const x=input();x.unsignedBytes=unsignedBytes;
  x.expectedSha256=unsignedBytes===modified?sha:createHash('sha256').update(unsignedBytes).digest('hex');
  const r=assessEchoUnfundedStageOne(x);
  assert.equal(r.completed,false);
  assert.ok(r.missing.includes('EXACT_UNSIGNED_PUMPSWAP_BYTES_AND_SIGNER'));
  assert.equal(r.canFund,false);
 }
});
