import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair,TransactionMessage,ComputeBudgetProgram,VersionedTransaction} from '@solana/web3.js';
import {auditEchoPumpSimulatedWalletDebit,ECHO_SIMULATED_PUMP_DEBIT_SIGNING_ENABLED,
 type EchoPumpDebitEvidence} from '../src/echo/pumpSimulatedDebitEvidence.js';
const wallet=Keypair.generate();
const bytes=new VersionedTransaction(new TransactionMessage({
 payerKey:wallet.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),
 instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:100000})]
}).compileToV0Message()).serialize();
const hash=createHash('sha256').update(bytes).digest('hex');
const now=1800000000000;
function input(change:Partial<EchoPumpDebitEvidence>={}):EchoPumpDebitEvidence{
 return {
  unsignedBytes:bytes,simulatedUnsignedSha256:hash,
  simulationSucceeded:true,simulationSignatureVerificationDisabled:true,
  actualWalletBalanceBeforeLamports:'100000000',
  simulatedWalletBalanceAfterLamports:'79950000',
  independentlyObservedNetworkFeeLamports:'50000',
  reservedAccountRentLamports:'2000000',
  independentlyBoundedAdditionalCpiLamports:'100000',
  exitReserveLamports:'2000000',pendingReservedLamports:'0',
  solUsdCents:'20000',observedAtMs:now,nowMs:now,...change
 };
}
test('numeric simulated fee and full debit: $4.43 with conservative rent/CPI and exit reserve',()=>{
 const x=auditEchoPumpSimulatedWalletDebit(input());
 assert.deepEqual(x,{
  ok:true,mode:'SIMULATION_AUDIT_ONLY',signingAllowed:false,
  unsignedSha256:hash,observedWalletDebitLamports:'20050000',
  plannedWalletDebitUpperBoundLamports:'22150000',
  allInCents:'443',exitReserveRetained:true
 });
 assert.equal(ECHO_SIMULATED_PUMP_DEBIT_SIGNING_ENABLED,false);
});
test('synthetic evidence cannot pass if simulation failed, nonce hash mismatched or fee zero',()=>{
 for(const change of [
  {simulationSucceeded:false},
  {simulationSignatureVerificationDisabled:false},
  {simulatedUnsignedSha256:'f'.repeat(64)},
  {independentlyObservedNetworkFeeLamports:'0'},
  {observedAtMs:now-3001},
  {actualWalletBalanceBeforeLamports:'1'},
  {simulatedWalletBalanceAfterLamports:'100000001'},
  {independentlyBoundedAdditionalCpiLamports:'UNBOUNDED'}
 ]){
  const result=auditEchoPumpSimulatedWalletDebit(input(change));
  assert.equal(result.ok,false,JSON.stringify(change));
 }
});
test('larger wallet debit, CPI upper bound and outstanding reserves fail closed',()=>{
 for(const change of [
  {simulatedWalletBalanceAfterLamports:'74000000'},
  {independentlyBoundedAdditionalCpiLamports:'4000000'},
  {pendingReservedLamports:'90000000'},
  {exitReserveLamports:'90000000'}
 ]){
  const r=auditEchoPumpSimulatedWalletDebit(input(change));
  assert.equal(r.ok,false,JSON.stringify(change));
 }
});
