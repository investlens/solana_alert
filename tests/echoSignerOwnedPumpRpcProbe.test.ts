import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair,PublicKey,SystemProgram,VersionedTransaction,TransactionMessage,
 ComputeBudgetProgram} from '@solana/web3.js';
import {probeSignerOwnedPumpRpc,
 ECHO_SIGNER_RPC_PROBE_CAN_SIGN,ECHO_SIGNER_RPC_PROBE_CAN_BROADCAST,
 type EchoSignerRpcReadOnly} from '../src/echo/signerOwnedPumpRpcProbe.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const tx=new VersionedTransaction(new TransactionMessage({
 payerKey:new PublicKey(wallet),
 recentBlockhash:Keypair.generate().publicKey.toBase58(),
 instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:300000})]
}).compileToV0Message()).serialize();
const sha=createHash('sha256').update(tx).digest('hex');
const now=1800000000000;
const stub=(override:{balance?:number;fee?:number|null;after?:number|null;
 err?:unknown;throwRpc?:boolean;contextSlot?:number;balanceSlot?:number;
 feeSlot?:number;blockhashSlot?:number;blockhashValid?:boolean;
 innerInstructions?:unknown;extraAccounts?:boolean}={}):{rpc:EchoSignerRpcReadOnly;calls:{balance:number;fee:number;simulation:number}}=>{
 const calls={balance:0,fee:0,simulation:0};
 const rpc:EchoSignerRpcReadOnly={
  async getBalanceAndContext(){calls.balance++;if(override.throwRpc)throw Error('private error');
   return {context:{slot:override.balanceSlot??12344},value:override.balance??100000000};},
  async getFeeForMessage(){calls.fee++;return {context:{slot:override.feeSlot??12344},
   value:override.fee===undefined?5000:override.fee};},
  async isBlockhashValid(){return {context:{slot:override.blockhashSlot??12344},
   value:override.blockhashValid??true};},
  async simulateTransaction(_tx,conf){
   calls.simulation++;
   assert.equal(conf.sigVerify,false);
   assert.equal(conf.replaceRecentBlockhash,false);
   assert.equal(conf.innerInstructions,true);
   assert.equal(conf.innerInstructionsEncoding,'json');
   assert.equal(conf.minContextSlot,Math.max(override.balanceSlot??12344,
    override.feeSlot??12344,override.blockhashSlot??12344));
   assert.deepEqual(conf.accounts.addresses,[wallet]);
   return {context:{slot:override.contextSlot??12345},
    value:{err:override.err===undefined?null:override.err,
    innerInstructions:override.innerInstructions===undefined?[]:override.innerInstructions,
    accounts:[override.after===null?null:{
     lamports:override.after??80000000,
     owner:SystemProgram.programId.toBase58()},
    ...(override.extraAccounts?[{lamports:1,owner:SystemProgram.programId.toBase58()}]:[])]}};
  }
 };
 return {rpc,calls};
};
test('exact signer-owned simulation gives provisional observed debit but never authorizes signing',async()=>{
 const x=stub();
 const r=await probeSignerOwnedPumpRpc({connection:x.rpc,unsignedBytes:tx,
  expectedUnsignedSha256:sha,nowMs:now});
 assert.deepEqual(r,{ok:true,mode:'SIGNER_RPC_PROVISIONAL_ONLY',
  unsignedSha256:sha,payerBalanceBeforeLamports:'100000000',
  payerBalanceAfterSimulationLamports:'80000000',
  observedDeltaLamports:'20000000',
  networkFeeEstimateLamports:'5000',observedAtMs:now,
  simulationContextSlot:12345,innerInstructionCount:0,computeUnitsConsumed:null,
  fullCpiAndExitProven:false,signingAllowed:false,broadcastAllowed:false});
 assert.equal(x.calls.simulation,1);
 assert.equal(ECHO_SIGNER_RPC_PROBE_CAN_SIGN,false);
 assert.equal(ECHO_SIGNER_RPC_PROBE_CAN_BROADCAST,false);
});
test('bad simulation context and malformed CPI traces fail closed',async()=>{
 for(const change of [
  {contextSlot:0},{contextSlot:12343},{balanceSlot:0},
  {feeSlot:12343},{blockhashSlot:12343},{blockhashValid:false},
  {feeSlot:12346},{blockhashSlot:12346},
  {innerInstructions:null},{extraAccounts:true},
  {innerInstructions:[{index:0,instructions:[{
   program:'system',programId:'11111111111111111111111111111111',
   parsed:{type:'transfer',info:{lamports:1}}
  }]}]},
  {innerInstructions:[{index:0,instructions:[{programIdIndex:0,accounts:[],data:'0'}]}]},
  {innerInstructions:[{index:99,instructions:[]}]},
  {innerInstructions:[{index:0,instructions:[]},{index:0,instructions:[]}]},
  {innerInstructions:[{index:0,instructions:[{programIdIndex:999,accounts:[],data:'2'}]}]},
  {innerInstructions:[{index:0,instructions:[{programIdIndex:0,accounts:[999],data:'2'}]}]},
  {innerInstructions:[{index:0,instructions:[{programIdIndex:0,accounts:[],data:4}]}]}
 ]){
  const x=stub(change);
  const result=await probeSignerOwnedPumpRpc({connection:x.rpc,unsignedBytes:tx,
   expectedUnsignedSha256:sha,nowMs:now});
  assert.equal(result.ok,false,JSON.stringify(change));
  assert.equal(result.signingAllowed,false);
  assert.equal(result.broadcastAllowed,false);
 }
});
test('tampered bytes and foreign fee payer cannot call RPC',async()=>{
 const x=stub();
 const tampered=Uint8Array.from(tx);tampered[tampered.length-1]^=1;
 const cases=[
  {unsignedBytes:tampered,expectedUnsignedSha256:sha},
  {unsignedBytes:new VersionedTransaction(new TransactionMessage({
    payerKey:Keypair.generate().publicKey,
    recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[]
   }).compileToV0Message()).serialize(),expectedUnsignedSha256:''}
 ];
 for(const c of cases){
  const hash=c.expectedUnsignedSha256||createHash('sha256').update(c.unsignedBytes).digest('hex');
  const r=await probeSignerOwnedPumpRpc({connection:x.rpc,
   unsignedBytes:c.unsignedBytes,expectedUnsignedSha256:hash,nowMs:now});
  assert.equal(r.ok,false);
 }
 assert.equal(x.calls.balance,0);
});
test('unfunded, failed, missing payer and RPC errors deny without signer access',async()=>{
 for(const change of [
  {balance:0},{balance:5000},{fee:null},{fee:0},
  {err:{InstructionError:[0,'InvalidAccountData']}},
  {after:null},{after:100000001},{after:-1},{throwRpc:true}
 ]){
  const x=stub(change);
  const r=await probeSignerOwnedPumpRpc({connection:x.rpc,
   unsignedBytes:tx,expectedUnsignedSha256:sha,nowMs:now});
  assert.equal(r.ok,false,JSON.stringify(change));
  assert.equal(r.broadcastAllowed,false);
 }
});

test('accounting observer sees only the same validated signer-owned simulation',async()=>{
 let captured:unknown=null;
 const x=stub();
 const r=await probeSignerOwnedPumpRpc({
  connection:x.rpc,unsignedBytes:tx,expectedUnsignedSha256:sha,
  nowMs:now,onValidatedSimulation:snapshot=>{captured=snapshot;}
 });
 assert.equal(r.ok,true);
 assert.deepEqual(captured,{
  innerInstructions:[],payerBeforeLamports:100000000,
  payerAfterLamports:80000000,networkFeeLamports:5000,
  simulationSlot:12345
 });
 let rejectedCapture=false;
 const bad=stub({balance:0});
 const denied=await probeSignerOwnedPumpRpc({
  connection:bad.rpc,unsignedBytes:tx,expectedUnsignedSha256:sha,
  nowMs:now,onValidatedSimulation:()=>{rejectedCapture=true;}
 });
 assert.equal(denied.ok,false);
 assert.equal(rejectedCapture,false);
});
