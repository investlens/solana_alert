import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey,TransactionMessage,VersionedTransaction,
 SystemProgram} from '@solana/web3.js';
import {reconcileEchoSignerPumpCpiLedger}
 from '../src/echo/signerOwnedPumpCpiAccounting.js';
import {createHash} from 'node:crypto';
// Public real-RPC observation from 2026-11-07: fee and rent are NOT
// authorizations. This test protects the exact arithmetic and failure gate.
test('constant 1,483,440-lamport discrepancy equals 165-byte rent minus fee',()=>{
 const debit=47_256_512n;
 const observed=45_773_072n;
 const fee=5_000n;
 const standardTokenRent=1_488_440n;
 assert.equal(debit-observed,1_483_440n);
 assert.equal(debit-observed+fee,standardTokenRent);
 assert.notEqual(debit-observed,standardTokenRent);
});
test('rent-equivalent difference cannot be silently credited or approved',()=>{
 const payer=new PublicKey('8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ');
 const destination=new PublicKey('11111111111111111111111111111112');
 const tx=new VersionedTransaction(new TransactionMessage({
  payerKey:payer,recentBlockhash:'11111111111111111111111111111111',
  instructions:[SystemProgram.transfer({
   fromPubkey:payer,toPubkey:destination,lamports:47_256_512
  })]
 }).compileToV0Message()).serialize();
 const r=reconcileEchoSignerPumpCpiLedger({
  unsignedBytes:tx,
  expectedUnsignedSha256:createHash('sha256').update(tx).digest('hex'),
  prePayerBalanceLamports:'100000000',
  postSimulatedPayerBalanceLamports:'54226928',
  networkFeeLamports:'5000',
  innerInstructions:[]
 });
 assert.equal(r.ok,false);
 if(!r.ok){
  assert.equal(r.reason,'UNEXPLAINED_PAYER_LAMPORT_BALANCE_CHANGE');
  assert.equal(r.diagnostic?.unexplainedAgainstDebitOnlyLamports,'-1483440');
  assert.equal(r.signingAllowed,false);
  assert.equal(r.broadcastAllowed,false);
 }
});
