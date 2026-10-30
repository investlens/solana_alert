import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,TransactionMessage,VersionedTransaction,SystemProgram,PublicKey} from '@solana/web3.js';
import {readOnlyJupiterSwapPreview,ECHO_SWAP_BROADCAST_ENABLED} from '../src/echo/readOnlyJupiterSwap.js';
const SOL='So11111111111111111111111111111111111111112';
const wallet=Keypair.generate().publicKey;
const output=Keypair.generate().publicKey.toBase58();
const tx=new VersionedTransaction(new TransactionMessage({
 payerKey:wallet,recentBlockhash:'11111111111111111111111111111111',
 instructions:[SystemProgram.transfer({fromPubkey:wallet,toPubkey:new PublicKey(output),lamports:1})]
}).compileToV0Message());
test('unsigned Jupiter preview performs quote, swap build and simulate only',async()=>{
 const methods:string[]=[];
 const quote={inputMint:SOL,outputMint:output,inAmount:'50000000',routePlan:[{swapInfo:{}}]};
 const transaction=Buffer.from(tx.serialize()).toString('base64');
 const fetcher=(async (url:string,opts?:RequestInit)=>{
  const method=url.includes('/quote')?'quote':url.includes('/swap')?'swap':'simulate';
  methods.push(method);
  if(method==='quote')return {ok:true,json:async()=>quote} as Response;
  if(method==='swap')return {ok:true,json:async()=>({swapTransaction:transaction})} as Response;
  assert.equal(JSON.parse(String(opts?.body)).method,'simulateTransaction');
  return {ok:true,json:async()=>({result:{value:{err:null,logs:['ok']}}})} as Response;
 }) as typeof fetch;
 const result=await readOnlyJupiterSwapPreview({rpcUrl:'https://example.com/rpc',
  publicWallet:wallet.toBase58(),outputMint:output,amountLamports:50000000,
  maxSlippageBps:100,jupiterApiKey:'test-key'},fetcher);
 assert.equal(result.ok,true);
 assert.deepEqual(methods,['quote','swap','simulate']);
 assert.equal(ECHO_SWAP_BROADCAST_ENABLED,false);
});
test('unsigned quote mismatch fails without fetching swap or simulating',async()=>{
 const methods:string[]=[];
 const fetcher=(async (url:string)=>{
  methods.push(url);
  return {ok:true,json:async()=>({inputMint:SOL,outputMint:output,inAmount:'50000000',routePlan:[]})} as Response;
 }) as typeof fetch;
 const result=await readOnlyJupiterSwapPreview({rpcUrl:'https://example.com/rpc',
  publicWallet:wallet.toBase58(),outputMint:output,amountLamports:50000000,
  maxSlippageBps:100,jupiterApiKey:'test-key'},fetcher);
 assert.equal(result.ok,false);
 assert.equal(methods.length,1);
});
