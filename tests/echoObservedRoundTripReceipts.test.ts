import test from 'node:test';
import assert from 'node:assert/strict';
import {observeEchoReceipt,reconcileEchoObservedRoundTrip,ECHO_RECEIPT_OUTCOME_ALLOWS_EXECUTION,
 type EchoReceipt} from '../src/echo/observedRoundTripReceipts.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint='D4AnTZk3spQgCEMpC4iqtFp8U2qbiDvzrzdaq7Dopump';
const sig='3'.repeat(64),otherSig='4'.repeat(64);
const buy:EchoReceipt={signature:sig,successful:true,confirmed:true,
 signerWallets:[wallet],wallet,mint,walletSolBeforeLamports:'500000000',
 walletSolAfterLamports:'398000000',feeLamports:'5000',
 preTokenBalances:[],postTokenBalances:[{owner:wallet,mint,amount:'1000000'}]};
const sell:EchoReceipt={signature:otherSig,successful:true,confirmed:true,
 signerWallets:[wallet],wallet,mint,walletSolBeforeLamports:'398000000',
 walletSolAfterLamports:'520000000',feeLamports:'5000',
 preTokenBalances:[{owner:wallet,mint,amount:'1000000'}],postTokenBalances:[]};
test('confirmed signer-owned real BUY and SELL receipts yield net wallet SOL change',()=>{
 const result=reconcileEchoObservedRoundTrip(buy,sell);
 assert.equal(result.ok,true);if(result.ok){
  assert.equal(result.netSolLamports,'20000000');
  assert.equal(result.totalNetworkFeesLamports,'10000');
  assert.equal(result.feesAlreadyInWalletSolDelta,true);
  assert.equal(result.feeAttributionVerified,false);
  assert.equal(result.signingApproved,false);
 }
 assert.equal(ECHO_RECEIPT_OUTCOME_ALLOWS_EXECUTION,false);
});
test('unconfirmed, failed, unsigned and third-party transactions are rejected',()=>{
 for(const modified of [
  {...buy,confirmed:false},{...buy,successful:false},
  {...buy,signerWallets:[]},{...buy,signerWallets:[wallet,'other']}
 ]){
  const r=observeEchoReceipt(modified,'BUY');
  assert.equal(r.ok,false);
 }
});
test('partial exit and mismatched mint cannot be shown as realized P/L',()=>{
 const partial={...sell,preTokenBalances:[{owner:wallet,mint,amount:'500000'}]};
 assert.equal(reconcileEchoObservedRoundTrip(buy,partial).ok,false);
 assert.equal(reconcileEchoObservedRoundTrip(buy,{...sell,mint:'different'}).ok,false);
});
test('unknown other token delta and missing fee fail closed',()=>{
 const extra={...buy,postTokenBalances:[...buy.postTokenBalances,
  {owner:wallet,mint:'So11111111111111111111111111111111111111112',amount:'100'}]};
 assert.equal(observeEchoReceipt(extra,'BUY').ok,false);
 assert.equal(observeEchoReceipt({...buy,feeLamports:null},'BUY').ok,false);
});
