import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyEchoManualWalletAppExit,ECHO_EXTERNAL_SELL_SLOT_RELEASE_ENABLED}
 from '../src/echo/manualWalletAppExitVerifier.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint='GczSofuFAmwZkTXBaw9kpeo36Sven8q9fXDXmvUSpump';
const buySignature='3'.repeat(64),sellSignature='4'.repeat(64);
const receipt={signature:sellSignature,successful:true,confirmed:true,
 signerWallets:[wallet],wallet,mint,
 walletSolBeforeLamports:'100000000',
 walletSolAfterLamports:'110000000',
 preTokenBalances:[{owner:wallet,mint,amount:'550000'}],
 postTokenBalances:[{owner:wallet,mint,amount:'0'}],
 feeLamports:'5000'};
const input={buySignature,buyState:'confirmed' as const,alreadyClosed:false,wallet,mint,
 sellReceipt:receipt,currentHeldTokenBalanceRaw:'0',
 currentBalanceSlot:4002,sellFinalizedSlot:4001,
 finalizedChainProofVerified:true};
test('finalized manual wallet-app full sell produces read-only proof, not DB release',()=>{
 const r=verifyEchoManualWalletAppExit(input);
 assert.equal(r.ok,true);
 if(r.ok){
  assert.equal(r.netWalletSolIncreaseLamports,'10000000');
  assert.equal(r.soldTokenUnitsRaw,'550000');
  assert.equal(r.safeToRequestDbClose,true);
  assert.equal(r.slotReleased,false);
 }
 assert.equal(ECHO_EXTERNAL_SELL_SLOT_RELEASE_ENABLED,false);
});
test('manual partial sell, unconfirmed buy, and missing finalized receipt do not release slot',()=>{
 for(const changed of [
  {currentHeldTokenBalanceRaw:'10000'},
  {buyState:'reserved' as const},
  {alreadyClosed:true},
  {finalizedChainProofVerified:false},
  {sellFinalizedSlot:4003},
  {sellReceipt:{...receipt,successful:false}},
  {sellReceipt:{...receipt,signerWallets:['5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij']}},
  {sellReceipt:{...receipt,walletSolAfterLamports:'90000000'}},
  {sellReceipt:{...receipt,postTokenBalances:[{owner:wallet,mint,amount:'550000'}]}},
  {sellReceipt:{...receipt,mint:'2'.repeat(44)}},
  {sellReceipt:{...receipt,signature:buySignature}},
 ]){
  const r=verifyEchoManualWalletAppExit({...input,...changed});
  assert.equal(r.ok,false);
  assert.equal(r.slotReleased,false);
 }
});
test('fake external exit for a different trading wallet is blocked',()=>{
 const r=verifyEchoManualWalletAppExit({...input,wallet:'5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij'});
 assert.deepEqual(r,{ok:false,reason:'RESERVATION_IDENTITY_MISMATCH',slotReleased:false});
});
