import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reviewShadowDebit, type AccountingSnapshot } from '../src/echo/adminShadowAccountingReview.js';
const base:AccountingSnapshot={
 preLamports:500000000n,postLamports:399000000n,networkFeeLamports:1000000n,
 reservedLamports:101000000n,maxStakeLamports:100000000n,rpcTrusted:true,
 transactionFinalized:true,transactionSignatureMatches:true,walletMatches:true,freshBalance:true,
};
describe('Echo shadow accounting review',()=>{
 it('accepts verified 0.1 SOL stake plus fee but never releases reserve',()=>{
  const r=reviewShadowDebit(base);
  assert.equal(r.accepted,true);
  assert.equal(r.purchaseDebitLamports,100000000n);
  assert.equal(r.releaseReserveAutomatically,false);
 });
 it('fails closed on missing proof, excess spend and fee inconsistencies',()=>{
  const cases:Partial<AccountingSnapshot>[]=[
   {rpcTrusted:false},{transactionFinalized:false},{walletMatches:false},
   {freshBalance:false},{transactionSignatureMatches:false},
   {postLamports:398000000n},{networkFeeLamports:102000000n},
   {reservedLamports:100000000n},{postLamports:501000000n},
  ];
  for(const patch of cases){
   const r=reviewShadowDebit({...base,...patch});
   assert.equal(r.accepted,false);
   assert.equal(r.requiresManualReview,true);
   assert.equal(r.releaseReserveAutomatically,false);
  }
 });
});
