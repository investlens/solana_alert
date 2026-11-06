import test from 'node:test';
import assert from 'node:assert/strict';
import {readEchoVerifiedWalletCapital,ECHO_BALANCE_PROOF_ALLOWS_SIGNING}
 from '../src/echo/trustedWalletCapitalReadOnly.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ',now=1800000000000;
function setup(input?:{lamports?:number;slot?:number;price?:number;priceAt?:number;
 status?:number;rpcError?:boolean;wallet?:string}){
 let calls=0;let payload:any;
 const post=(async(_url:string,options?:RequestInit)=>{
  calls++;payload=JSON.parse(String(options?.body));
  return new Response(JSON.stringify(input?.rpcError?{error:{code:-1}}:{
   result:{context:{slot:input?.slot??500},value:input?.lamports??50000000}
  }),{status:input?.status??200});
 }) as typeof fetch;
 const priceReader={readFreshSolUsd:async()=>({
  usdCentsPerSol:input?.price??20000,observedAtMs:input?.priceAt??now-250,
  source:'TRUSTED_REFERENCE'
 })};
 const args={wallet:input?.wallet??wallet,
  rpcUrl:'https://example.invalid/rpc?api-key=hidden',
  priceReader,post,clock:()=>now,minContextSlot:400};
 return {args,calls:()=>calls,payload:()=>payload};
}
test('same pinned wallet balance is confirmed and converted with integer cents',async()=>{
 const f=setup();
 const result=await readEchoVerifiedWalletCapital(f.args);
 assert.deepEqual(result,{
  ok:true,wallet,lamports:'50000000',spendableWalletCents:'1000',
  balanceVerifiedAtIso:new Date(now).toISOString(),
  contextSlot:500,solUsdCents:20000,readOnly:true
 });
 assert.equal(f.calls(),1);
 assert.equal(f.payload().method,'getBalance');
 assert.equal(f.payload().params[1].commitment,'confirmed');
 assert.equal(ECHO_BALANCE_PROOF_ALLOWS_SIGNING,false);
});
test('untrusted wallet, stale price, insufficient slot and bad RPC fail closed',async()=>{
 for(const x of [
  {wallet:'5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij'},
  {priceAt:now-4000},{priceAt:now+1},{price:0},
  {slot:399},{lamports:-1},{status:500},{rpcError:true}
 ]){
  const f=setup(x);
  const result=await readEchoVerifiedWalletCapital(f.args);
  assert.equal(result.ok,false);
  assert.equal(result.readOnly,true);
 }
});
