import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inspectShadowIntent } from '../src/echo/adminShadowReconciliationBridge.js';
const signature='5W5d2xZT8K2QTmpixHviNrt5E38esAhqmjNVfqxmfm4Jz8RoEfwsW6efsEJ6ptxT1tj5sxeGFj8UicopFP5TT3Ed';
const base={intent:'submitted' as const,signature,trustedRpc:true,historyCaughtUp:true,
 rpcHealthy:true,blockhashExpired:false,observedTokenIncrease:true};
describe('Echo shadow RPC reconciliation bridge',()=>{
 it('marks confirmed only on finalized success and verified token increase',async()=>{
  const transport=async()=>({result:{value:[{confirmationStatus:'finalized',err:null,slot:123}]}});
  assert.equal((await inspectShadowIntent(transport,base)).nextState,'confirmed');
  assert.notEqual((await inspectShadowIntent(transport,{...base,observedTokenIncrease:false})).nextState,'confirmed');
 });
 it('holds funds and disallows retries when RPC fails',async()=>{
  const r=await inspectShadowIntent(async()=>{throw Error('RPC 429')},base);
  assert.equal(r.nextState,'unknown');
  assert.equal(r.mayRetryPurchase,false);
  assert.equal(r.releaseReservedFunds,false);
 });
});
