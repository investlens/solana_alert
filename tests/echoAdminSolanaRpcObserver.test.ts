import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { observeSolanaSignature } from '../src/echo/adminSolanaRpcObserver.js';
const signature='5W5d2xZT8K2QTmpixHviNrt5E38esAhqmjNVfqxmfm4Jz8RoEfwsW6efsEJ6ptxT1tj5sxeGFj8UicopFP5TT3Ed';
describe('Echo read-only Solana RPC observer',()=>{
 it('uses getSignatureStatuses history lookup only',async()=>{
  let calls=0;
  const r=await observeSolanaSignature(async(method,params)=>{
   calls++;
   assert.equal(method,'getSignatureStatuses');
   assert.equal((params[1] as {searchTransactionHistory:boolean}).searchTransactionHistory,true);
   return {result:{value:[{confirmationStatus:'finalized',err:null,slot:42}]}};
  },signature,true,true);
  assert.equal(calls,1);
  assert.equal(r.finalizedSuccess,true);
 });
 it('fails closed on untrusted RPC, errors and missing history',async()=>{
  const transport=async()=>{throw Error('429')};
  assert.equal((await observeSolanaSignature(transport,signature,true,true)).authoritative,false);
  assert.equal((await observeSolanaSignature(transport,signature,false,true)).authoritative,false);
  assert.equal((await observeSolanaSignature(transport,signature,true,false)).authoritative,false);
  assert.equal((await observeSolanaSignature(async()=>({result:{value:[null]}}),signature,true,true)).authoritative,false);
  assert.equal((await observeSolanaSignature(async()=>({result:{value:[]}}),signature,true,true)).authoritative,false);
 });
});
