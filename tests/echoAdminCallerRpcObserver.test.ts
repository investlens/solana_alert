import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {observeEchoCallerBuy} from '../src/echo/adminCallerRpcObserver.js';
const input={signature:'2'.repeat(64),
 callerWallet:'5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',
 mint:'So11111111111111111111111111111111111111112',
 rpcTrusted:true,historyCaughtUp:true,ageSeconds:3};
describe('Echo caller RPC observer',()=>{
 it('does not promote a finalized signed transaction into a verified BUY without DEX parsing',async()=>{
  let calls=0;
  const r=await observeEchoCallerBuy(async(method)=>{
   calls++;if(method==='getSignatureStatuses')return {result:{value:[{confirmationStatus:'finalized',err:null}]}};
   assert.equal(method,'getTransaction');
   return {result:{meta:{err:null},transaction:{signatures:[input.signature],
    message:{accountKeys:[{pubkey:input.callerWallet,signer:true}],instructions:[]}}}};
  },input);
  assert.equal(calls,2);assert.equal(r.verified,false);
  assert.equal(r.reason,'NOT_VERIFIED_CALLER_BUY');
 });
 it('rejects an unfinalized or failed signature even if transaction parsing succeeds',async()=>{
  const r=await observeEchoCallerBuy(async(method)=>method==='getSignatureStatuses'
   ?{result:{value:[{confirmationStatus:'confirmed',err:null}]}}
   :{result:{meta:{err:null},transaction:{signatures:[input.signature],message:{accountKeys:[],instructions:[]}}}},input);
  assert.equal(r.verified,false);assert.equal(r.reason,'NOT_FINALIZED_OR_FAILED');
 });
 it('rejects untrusted RPC without querying',async()=>{
  const r=await observeEchoCallerBuy(async()=>{throw Error('must not call')},
   {...input,rpcTrusted:false});
  assert.equal(r.verified,false);assert.equal(r.reason,'UNTRUSTED_RPC');
 });
});
