import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,TransactionMessage,VersionedTransaction,ComputeBudgetProgram} from '@solana/web3.js';
import {readSignedEchoTransaction,submitEchoSignedTransaction,
 inspectEchoTransactionConfirmation,ECHO_LIVE_SUBMISSION_COMPILED_ENABLED} from '../src/echo/isolatedTransactionTransport.js';
import bs58 from 'bs58';
const signer=Keypair.generate();
const blockhash=Keypair.generate().publicKey.toBase58();
const msg=new TransactionMessage({payerKey:signer.publicKey,recentBlockhash:blockhash,
 instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:100000})]}).compileToV0Message();
const tx=new VersionedTransaction(msg);tx.sign([signer]);
const signedBase64=Buffer.from(tx.serialize()).toString('base64');
const signature=bs58.encode(tx.signatures[0]);
const rpcUrl='https://rpc.example.org/';
test('signed bytes match expected signer, but live submissions are hard disabled',async()=>{
 assert.deepEqual(readSignedEchoTransaction(signedBase64,signer.publicKey.toBase58()).signature,signature);
 assert.equal(readSignedEchoTransaction(signedBase64,Keypair.generate().publicKey.toBase58()).ok,false);
 assert.equal(ECHO_LIVE_SUBMISSION_COMPILED_ENABLED,false);
 let networkCalls=0;
 const post=(async()=>{networkCalls++;throw Error('unexpected network call');}) as typeof fetch;
 const result=await submitEchoSignedTransaction({rpcUrl,signedBase64,
  expectedWallet:signer.publicKey.toBase58(),killSwitchEngaged:false,
  ownerApprovedLiveExecution:true},post);
 assert.deepEqual(result,{kind:'REJECTED',reason:'LIVE_SUBMISSION_DISABLED'});
 assert.equal(networkCalls,0);
});
test('confirmation adapter identifies final, pending, rejected and unknown states',async()=>{
 const response=(value:unknown)=> (async()=>({ok:true,json:async()=>value}) as Response) as typeof fetch;
 const inspect=(value:unknown)=>inspectEchoTransactionConfirmation({rpcUrl,signature},response(value));
 assert.deepEqual(await inspect({result:{value:[{err:null,confirmationStatus:'finalized'}]}}),
  {kind:'CONFIRMED'});
 assert.deepEqual(await inspect({result:{value:[{err:{InstructionError:[0,'Custom']},confirmationStatus:'finalized'}]}}),
  {kind:'FAILED',reason:'CHAIN_TRANSACTION_ERROR'});
 assert.deepEqual(await inspect({result:{value:[null]}}),{kind:'PENDING'});
 assert.deepEqual(await inspect({error:'offline'}),{kind:'UNKNOWN'});
});
