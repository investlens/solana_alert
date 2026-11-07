import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,VersionedTransaction,TransactionMessage,
 ComputeBudgetProgram,type Connection} from '@solana/web3.js';
import {simulateSignerCompiledCpiOnPinnedRpc,
 ECHO_COMPILED_CPI_SIMULATOR_CAN_SIGN,ECHO_COMPILED_CPI_SIMULATOR_CAN_BROADCAST}
 from '../src/echo/signerOwnedCompiledCpiSimulation.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const tx=new VersionedTransaction(new TransactionMessage({
 payerKey:new PublicKey(wallet),recentBlockhash:Keypair.generate().publicKey.toBase58(),
 instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:150000})]
}).compileToV0Message());
const config={
 sigVerify:false as const,replaceRecentBlockhash:false as const,
 commitment:'confirmed' as const,minContextSlot:100,
 innerInstructions:true as const,innerInstructionsEncoding:'json' as const,
 accounts:{encoding:'base64' as const,addresses:[wallet]}
};
test('raw pinned RPC transport forwards indexed CPI encoding and exact unsigned bytes',async()=>{
 let count=0;
 const rpc={
  async _rpcRequest(method:string,args:unknown[]){
   count++;
   assert.equal(method,'simulateTransaction');
   const [encoded,opts]=args as [string,Record<string,any>];
   assert.equal(encoded,Buffer.from(tx.serialize()).toString('base64'));
   assert.deepEqual(opts,{
    encoding:'base64',sigVerify:false,replaceRecentBlockhash:false,
    commitment:'confirmed',minContextSlot:100,
    innerInstructions:true,innerInstructionsEncoding:'json',
    accounts:{encoding:'base64',addresses:[wallet]}
   });
   return {result:{context:{slot:101},value:{err:null,
    innerInstructions:[{index:0,instructions:[]}],accounts:[]}}};
  }
 } as unknown as Connection;
 const result=await simulateSignerCompiledCpiOnPinnedRpc(rpc,tx,config);
 assert.equal(result.context.slot,101);
 assert.equal(count,1);
 assert.equal(ECHO_COMPILED_CPI_SIMULATOR_CAN_SIGN,false);
 assert.equal(ECHO_COMPILED_CPI_SIMULATOR_CAN_BROADCAST,false);
});
test('never send a request with altered simulation safety flags',async()=>{
 let requests=0;
 const rpc={async _rpcRequest(){requests++;return {};}} as unknown as Connection;
 for(const override of [
  {sigVerify:true},{replaceRecentBlockhash:true},
  {innerInstructionsEncoding:'jsonParsed'},{commitment:'processed'},
  {minContextSlot:0},{accounts:{encoding:'base64',addresses:[Keypair.generate().publicKey.toBase58()]}}
 ]){
  await assert.rejects(()=>simulateSignerCompiledCpiOnPinnedRpc(
   rpc,tx,{...config,...override} as typeof config));
 }
 assert.equal(requests,0);
});
test('RPC errors and malformed envelopes remain hard failures',async()=>{
 for(const response of [
  {error:{code:-32602,message:'bad config'}},{result:null},
  {result:{value:{err:null}}},{result:{context:{slot:100}}}
 ]){
  const rpc={async _rpcRequest(){return response;}} as unknown as Connection;
  await assert.rejects(()=>simulateSignerCompiledCpiOnPinnedRpc(rpc,tx,config));
 }
});
