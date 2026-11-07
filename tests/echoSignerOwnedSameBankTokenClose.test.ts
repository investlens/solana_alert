import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PublicKey,Keypair,VersionedTransaction,TransactionMessage,TransactionInstruction,SystemProgram} from '@solana/web3.js';
import {probeSignerOwnedPumpRpc} from '../src/echo/signerOwnedPumpRpcProbe.js';
const payer=new PublicKey('8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ');
const closed=Keypair.generate().publicKey;
const token=new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const close=new TransactionInstruction({programId:token,keys:[
 {pubkey:closed,isSigner:false,isWritable:true},
 {pubkey:payer,isSigner:false,isWritable:true},
 {pubkey:payer,isSigner:true,isWritable:false}
],data:Buffer.from([9])});
const makeTx=(ixs:TransactionInstruction[])=>new VersionedTransaction(
 new TransactionMessage({payerKey:payer,
 recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:ixs
 }).compileToV0Message()).serialize();
const tx=makeTx([SystemProgram.transfer({fromPubkey:payer,toPubkey:closed,lamports:10000000}),close]);
const sha=createHash('sha256').update(tx).digest('hex');
const rpc=(afterClose:null|object,requested:string[][])=>({
 async getBalanceAndContext(){return {context:{slot:100},value:100000000};},
 async getFeeForMessage(){return {context:{slot:100},value:5000};},
 async isBlockhashValid(){return {context:{slot:100},value:true};},
 async simulateTransaction(_:unknown,config:{accounts:{addresses:string[]}}){
  requested.push(config.accounts.addresses);
  return {context:{slot:101},value:{err:null,innerInstructions:[],
   accounts:[{lamports:91000000,owner:SystemProgram.programId.toBase58()},afterClose]}};
 }
});
test('same exact simulation verifies closure account absence without signing',async()=>{
 const addresses:string[][]=[];
 const result=await probeSignerOwnedPumpRpc({
  connection:rpc(null,addresses) as any,unsignedBytes:tx,
  expectedUnsignedSha256:sha,nowMs:1800000000000
 });
 assert.equal(result.ok,true,JSON.stringify(result));
 if(result.ok){
  assert.equal(result.sameSimulationTokenCloseConfirmed,true);
  assert.equal(result.signingAllowed,false);
  assert.equal(result.broadcastAllowed,false);
 }
 assert.deepEqual(addresses,[[payer.toBase58(),closed.toBase58()]]);
});
test('close account remains in same simulation state => deny',async()=>{
 const result=await probeSignerOwnedPumpRpc({
  connection:rpc({lamports:1488440,owner:token.toBase58()},[]) as any,
  unsignedBytes:tx,expectedUnsignedSha256:sha,nowMs:1800000000000
 });
 assert.equal(result.ok,false);
 if(!result.ok)assert.equal(result.reason,'PAYER_TOKEN_CLOSE_SOURCE_NOT_ABSENT_AFTER_SIMULATION');
});
test('payer must be close authority before any RPC',async()=>{
 const other=Keypair.generate().publicKey;
 const badClose=new TransactionInstruction({programId:token,keys:[
  {pubkey:closed,isSigner:false,isWritable:true},
  {pubkey:payer,isSigner:false,isWritable:true},
  {pubkey:other,isSigner:false,isWritable:false}
 ],data:Buffer.from([9])});
 const bytes=makeTx([badClose]);
 let calls=0;
 const result=await probeSignerOwnedPumpRpc({
  connection:{...rpc(null,[]),
   async getBalanceAndContext(){calls++;return {context:{slot:100},value:100000000};}
  } as any,unsignedBytes:bytes,
  expectedUnsignedSha256:createHash('sha256').update(bytes).digest('hex'),
  nowMs:1800000000000
 });
 assert.equal(result.ok,false);
 assert.equal(calls,0);
});
