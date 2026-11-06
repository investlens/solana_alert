import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,ComputeBudgetProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {readOnlyPumpLocalPreview,ECHO_PUMP_PORTAL_BROADCAST_ENABLED} from '../src/echo/readOnlyPumpLocalPreview.js';
const payer=Keypair.generate(),mint=Keypair.generate().publicKey.toBase58();
const msg=new TransactionMessage({payerKey:payer.publicKey,
 recentBlockhash:Keypair.generate().publicKey.toBase58(),
 instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:100000})]}).compileToV0Message();
const bytes=Buffer.from(new VersionedTransaction(msg).serialize());
const base={side:'BUY' as const,wallet:payer.publicKey.toBase58(),mint,
 amount:0.05,slippagePercent:2,rpcUrl:'https://rpc.example.org/',
 pool:'pump' as const};
test('PumpPortal read-only BUY request only builds and RPC simulates',async()=>{
 const methods:string[]=[];
 const fetcher=(async(url:string,options:RequestInit)=>{
  if(url.includes('/trade-local')){
   const body=JSON.parse(String(options.body));
   assert.equal(body.action,'buy');assert.equal(body.amount,0.05);
   assert.equal(body.priorityFee,0);
   methods.push('BUILDER');
   return new Response(new Uint8Array(bytes),{status:200});
  }
  const body=JSON.parse(String(options.body));
  assert.equal(body.method,'simulateTransaction');methods.push('SIMULATE');
  return {ok:true,json:async()=>({result:{value:{err:null,unitsConsumed:85000}}})} as Response;
 }) as typeof fetch;
 const result=await readOnlyPumpLocalPreview(base,fetcher);
 assert.equal(result.ok,true);
 assert.deepEqual(methods,['BUILDER','SIMULATE']);
 assert.equal(ECHO_PUMP_PORTAL_BROADCAST_ENABLED,false);
});
test('read-only SELL builds token side, rejects wallet mismatch and failed simulation',async()=>{
 const methods:string[]=[];
 const fetcher=(async(url:string,options:RequestInit)=>{
  if(url.includes('/trade-local')){
   const body=JSON.parse(String(options.body));
   assert.equal(body.action,'sell');assert.equal(body.denominatedInSol,'false');
   methods.push('BUILDER');
   return new Response(new Uint8Array(bytes),{status:200});
  }
  methods.push('SIMULATE');
  return {ok:true,json:async()=>({result:{value:{err:{InstructionError:[0,'Custom']}}}})} as Response;
 }) as typeof fetch;
 assert.equal((await readOnlyPumpLocalPreview({...base,side:'SELL',amount:10},fetcher)).ok,false);
 assert.deepEqual(methods,['BUILDER','SIMULATE']);
 const evil=async()=>new Response(new Uint8Array(bytes),{status:200});
 assert.equal((await readOnlyPumpLocalPreview({...base,wallet:Keypair.generate().publicKey.toBase58()},evil as typeof fetch)).ok,false);
});

test('HTTP 400 builder refusal stays fail-closed and emits categories, never arbitrary response',async()=>{
 const scenarios:[
  {body:'Insufficient funds for transaction',category:'WALLET_BALANCE'},
  {body:'No matching bonding curve or pool',category:'POOL_OR_MIGRATION'},
  {body:'Some opaque error [sensitive request content]',category:'UNCLASSIFIED'}
 ]=[
  {body:'Insufficient funds for transaction',category:'WALLET_BALANCE'},
  {body:'No matching bonding curve or pool',category:'POOL_OR_MIGRATION'},
  {body:'Some opaque error [sensitive request content]',category:'UNCLASSIFIED'}
 ];
 for(const s of scenarios){
  let calls=0;
  const mock=(async()=>{calls++;return new Response(s.body,{status:400})}) as typeof fetch;
  const result=await readOnlyPumpLocalPreview({...base,amount:0.025,pool:'pump-amm'},mock);
  assert.equal(result.ok,false);
  assert.equal(result.builderHttpStatus,400);
  assert.equal(result.builderFailureCategory,s.category);
  assert.equal(JSON.stringify(result).includes(s.body),false);
  assert.equal(calls,1);
  assert.equal(result.transactionHash,undefined);
 }
});
