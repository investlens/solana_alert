import { describe,it } from 'node:test';
import assert from 'node:assert/strict';
import {verifyEchoCallerBuyEvidence} from '../src/echo/adminCallerEvidence.js';
const valid={callerWallet:'5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',
 transactionSignature:'a'.repeat(64),tokenMint:'So11111111111111111111111111111111111111112',
 verifiedSigner:true,verifiedSwapBuy:true,finalized:true,rpcTrusted:true,
 transactionAgeSeconds:10,tokenTransferOnly:false};
describe('Echo caller evidence',()=>{
 it('accepts only trusted, finalized, recent BUYs from allowlisted wallets',()=>{
  assert.equal(verifyEchoCallerBuyEvidence(valid).verified,true);
  for(const patch of [
   {callerWallet:'X'.repeat(44)},{verifiedSigner:false},{verifiedSwapBuy:false},
   {finalized:false},{rpcTrusted:false},{tokenTransferOnly:true},
   {transactionAgeSeconds:61},{transactionAgeSeconds:-1},
  ])assert.equal(verifyEchoCallerBuyEvidence({...valid,...patch}).verified,false);
 });
});
