import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,SystemProgram,TransactionMessage,
 VersionedTransaction,type Connection} from '@solana/web3.js';
import {observeTokenCloseSourcesReadOnly,
 ECHO_TOKEN_CLOSE_REFUND_CAN_SIGN,ECHO_TOKEN_CLOSE_REFUND_CAN_BROADCAST}
 from '../src/echo/signerOwnedTokenCloseRefundEvidence.js';
const payer=new PublicKey('8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ');
const source=Keypair.generate().publicKey;
const tx=new VersionedTransaction(new TransactionMessage({
 payerKey:payer,recentBlockhash:Keypair.generate().publicKey.toBase58(),
 instructions:[SystemProgram.transfer({fromPubkey:payer,toPubkey:source,lamports:20000000})]
}).compileToV0Message());
const index=tx.message.staticAccountKeys.findIndex(k=>k.equals(source));
const tokenProgram=new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
test('reads only exact-message token close source with slot floor, never asserts refund',async()=>{
 let calls=0;
 const rpc={async getMultipleAccountsInfoAndContext(keys:PublicKey[],config:any){
  calls++;assert.deepEqual(keys.map(k=>k.toBase58()),[source.toBase58()]);
  assert.deepEqual(config,{commitment:'confirmed',minContextSlot:123});
  return {context:{slot:124},value:[{owner:tokenProgram,executable:false,
   data:Buffer.alloc(165),lamports:2039280,rentEpoch:0}]};
 }};
 const result=await observeTokenCloseSourcesReadOnly({
  tx,sourceIndexes:[index],minSlot:123,rpc
 });
 assert.equal(result.status,'CANDIDATE_PRESTATE_ONLY',JSON.stringify(result));
 if(result.status==='CANDIDATE_PRESTATE_ONLY'){
  assert.equal(result.observedPrestateLamports,'2039280');
  assert.equal(result.refundProven,false);
  assert.equal(result.exactSimulationBankMatched,false);
 }
 assert.equal(calls,1);
 assert.equal(ECHO_TOKEN_CLOSE_REFUND_CAN_SIGN,false);
 assert.equal(ECHO_TOKEN_CLOSE_REFUND_CAN_BROADCAST,false);
});
test('missing ephemeral account is not silently counted as refund',async()=>{
 const rpc={async getMultipleAccountsInfoAndContext(){return {
  context:{slot:124},value:[null]
 };}};
 const result=await observeTokenCloseSourcesReadOnly({
  tx,sourceIndexes:[index],minSlot:123,rpc
 });
 assert.equal(result.status,'CANDIDATE_PRESTATE_ONLY');
 if(result.status==='CANDIDATE_PRESTATE_ONLY'){
  assert.equal(result.existingTokenAccounts,0);
  assert.equal(result.observedPrestateLamports,'0');
  assert.equal(result.refundProven,false);
 }
});
test('bad source, mismatched slot or owner fail before approval',async()=>{
 let calls=0;
 const rpc={async getMultipleAccountsInfoAndContext(){calls++;return {
  context:{slot:122},value:[{owner:payer,executable:false,
   data:Buffer.alloc(5),lamports:100,rentEpoch:0}]
 };}};
 for(const sources of [[0],[99],[index,index],[]]){
  const result=await observeTokenCloseSourcesReadOnly({
   tx,sourceIndexes:sources,minSlot:123,rpc
  });
  assert.equal(result.status,'UNVERIFIED');
 }
 assert.equal(calls,0);
 const result=await observeTokenCloseSourcesReadOnly({
  tx,sourceIndexes:[index],minSlot:123,rpc
 });
 assert.equal(result.status,'UNVERIFIED');
 assert.equal(calls,1);
});
