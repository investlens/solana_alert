import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateEchoUnsignedTransaction,ECHO_SEND_TRANSACTION_ENABLED} from '../src/echo/readOnlySimulation.js';

const input='A'.repeat(200);
const rpc='https://example-rpc.invalid';
async function check(value:unknown){
 const calls:string[]=[];
 const post=(async(url:string,options:RequestInit)=>{
  assert.equal(url,rpc);
  const payload=JSON.parse(String(options.body));
  calls.push(payload.method);
  assert.equal(payload.method,'simulateTransaction');
  assert.deepEqual(payload.params[1],{
   encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,
   commitment:'processed'
  });
  return {ok:true,json:async()=>({result:{value}})} as Response;
 }) as typeof fetch;
 const result=await simulateEchoUnsignedTransaction(rpc,input,post);
 return {result,calls};
}
test('simulation recognizes insufficient funds as a balance blocker, never a route success',async()=>{
 const {result,calls}=await check({err:{InstructionError:[0,'InsufficientFunds']},logs:[]});
 assert.deepEqual(result,{ok:false,reason:'SIMULATION_REJECTED',failureClass:'INSUFFICIENT_FUNDS_OR_TOKENS'});
 assert.deepEqual(calls,['simulateTransaction']);
 assert.equal(ECHO_SEND_TRANSACTION_ENABLED,false);
});
test('simulation classifies missing accounts and onchain failures without exposing logs',async()=>{
 const missing=await check({err:'AccountNotFound',logs:[]});
 assert.equal(missing.result.failureClass,'ACCOUNT_NOT_PRESENT');
 const failure=await check({err:{InstructionError:[0,{Custom:6001}]},logs:[]});
 assert.equal(failure.result.failureClass,'ONCHAIN_INSTRUCTION_REJECTED');
});
test('only err:null is a successful RPC simulation',async()=>{
 const success=await check({err:null,logs:['Program log: done']});
 assert.equal(success.result.ok,true);
 assert.equal(success.result.logs?.length,1);
});
