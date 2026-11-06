import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBuyAdmission,SLINGOOR_WALLET,CHAIRMAN_WALLET,
 MAX_SOL_PER_BUY} from '../src/echo/liveBuyPolicy.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const base={callerWallet:SLINGOOR_WALLET,
 mint:'GczSofuFAmwZkTXBaw9kpeo36Sven8q9fXDXmvUSpump',
 amountSol:2.5,side:'BUY' as const,isVerifiedSwap:true,transactionSignature:'3'.repeat(64)};
test('caller may BUY >0.1 SOL, while our spend remains separately capped',()=>{
 assert.equal(MAX_SOL_PER_BUY,0.1);
 assert.equal(validateBuyAdmission(base,wallet).allowed,true);
 assert.equal(validateBuyAdmission({...base,callerWallet:CHAIRMAN_WALLET},wallet).allowed,true);
});
test('nonbuys, transfers and zero/invalid amounts never qualify',()=>{
 for(const changed of [
  {side:'SELL' as const},{isVerifiedSwap:false},{amountSol:0},
  {amountSol:-1},{amountSol:NaN},{amountSol:Infinity},
  {callerWallet:'2'.repeat(44)}
 ]){
  assert.equal(validateBuyAdmission({...base,...changed},wallet).allowed,false);
 }
});
