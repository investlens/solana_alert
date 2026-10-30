import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,TransactionMessage,VersionedTransaction,ComputeBudgetProgram,TransactionInstruction,PublicKey} from '@solana/web3.js';
import {readOnlyEchoJupiterV2Swap,ECHO_JUPITER_V2_EXECUTION_ENABLED} from '../src/echo/readOnlyJupiterV2Swap.js';
const wallet=Keypair.generate().publicKey.toBase58();
const mint=Keypair.generate().publicKey.toBase58();
const SOL='So11111111111111111111111111111111111111112';
const message=new TransactionMessage({
 payerKey:new PublicKey(wallet),
 recentBlockhash:Keypair.generate().publicKey.toBase58(),
 instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:100000}),
 new TransactionInstruction({programId:new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'),keys:[],data:Buffer.from([1])})]
}).compileToV0Message();
const tx=new VersionedTransaction(message);
const encoded=Buffer.from(tx.serialize()).toString('base64');
type Scenario={side:'BUY'|'SELL';alter?:Record<string,unknown>;simulationError?:unknown};
function fake(s:Scenario){
 const calls:string[]=[];
 const fetcher=(async(url:string,options?:RequestInit)=>{
  const u=String(url);
  if(u.includes('/swap/v2/order')){
   calls.push('GET_ORDER');
   const q=new URL(u);
   const input=s.side==='BUY'?SOL:mint,output=s.side==='BUY'?mint:SOL;
   assert.equal(q.searchParams.get('inputMint'),input);
   assert.equal(q.searchParams.get('outputMint'),output);
   assert.equal(q.searchParams.get('taker'),wallet);
   const order={inputMint:input,outputMint:output,inAmount:'50000000',outAmount:'1000000',
    transaction:encoded,transactionVersion:0,signatureFeePayer:wallet,requestId:'request-1',...s.alter};
   return {ok:true,json:async()=>order} as Response;
  }
  calls.push('RPC_SIMULATE');
  const req=JSON.parse(String(options?.body));
  assert.equal(req.method,'simulateTransaction');
  return {ok:true,json:async()=>({result:{value:{err:s.simulationError??null,logs:['ok']}}})} as Response;
 }) as typeof fetch;
 return {calls,fetcher};
}
const request=(side:'BUY'|'SELL')=>({
 side,rpcUrl:'https://example-rpc.invalid/',publicWallet:wallet,mint,
 amountRaw:'50000000',maxSlippageBps:100,jupiterApiKey:'test-key'
});
test('BUY v2 /order is checked then only read-only RPC simulated',async()=>{
 const f=fake({side:'BUY'});
 const v=await readOnlyEchoJupiterV2Swap(request('BUY'),f.fetcher);
 assert.equal(v.ok,true);
 if(v.ok){
  assert.equal(v.inputMint,SOL);
  assert.equal(v.outputMint,mint);
  assert.match(v.unsignedTransactionSha256,/^[a-f0-9]{64}$/);
 }
 assert.deepEqual(f.calls,['GET_ORDER','RPC_SIMULATE']);
 assert.equal(ECHO_JUPITER_V2_EXECUTION_ENABLED,false);
});
test('SELL v2 /order reverses pair, RPC simulation remains broadcast-free',async()=>{
 const f=fake({side:'SELL'});
 const v=await readOnlyEchoJupiterV2Swap(request('SELL'),f.fetcher);
 assert.equal(v.ok,true);
 if(v.ok)assert.equal(v.outputMint,SOL);
 assert.deepEqual(f.calls,['GET_ORDER','RPC_SIMULATE']);
});
test('wrong wallet payer, tampered quote and rejected RPC simulation fail closed',async()=>{
 for(const alteration of [
  {signatureFeePayer:Keypair.generate().publicKey.toBase58()},
  {inputMint:mint},
  {inAmount:'1234'},
  {transaction:'junk'}
 ]){
  const f=fake({side:'BUY',alter:alteration});
  assert.equal((await readOnlyEchoJupiterV2Swap(request('BUY'),f.fetcher)).ok,false);
  assert.deepEqual(f.calls,['GET_ORDER']);
 }
 const f=fake({side:'BUY',simulationError:{InstructionError:[0,'Custom']}});
 assert.equal((await readOnlyEchoJupiterV2Swap(request('BUY'),f.fetcher)).ok,false);
 assert.deepEqual(f.calls,['GET_ORDER','RPC_SIMULATE']);
});
