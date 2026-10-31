import test from 'node:test';
import assert from 'node:assert/strict';
import {AddressLookupTableAccount,ComputeBudgetProgram,Keypair,
 PublicKey,SystemProgram,TransactionInstruction,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {auditEchoUnsignedV0Transaction,ECHO_ACCOUNT_AUDIT_GRANTS_SIGNING}
 from '../src/echo/readOnlyTransactionAccountAudit.js';
const payer=Keypair.generate().publicKey;
const account=Keypair.generate().publicKey;
const tableKey=Keypair.generate().publicKey;
const keypair=Keypair.generate();
const table=new AddressLookupTableAccount({key:tableKey,state:{
 deactivationSlot:18446744073709551615n,lastExtendedSlot:0,
 lastExtendedSlotStartIndex:0,authority:undefined,addresses:[account]}});
const provider={lookup:async(k:PublicKey)=>k.equals(tableKey)?table:null};
function encode(ix:TransactionInstruction[]){
 const m=new TransactionMessage({payerKey:payer,
  recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:ix
 }).compileToV0Message([table]);
 return Buffer.from(new VersionedTransaction(m).serialize()).toString('base64');
}
const swap=()=>new TransactionInstruction({programId:keypair.publicKey,
 keys:[{pubkey:account,isSigner:false,isWritable:true}],data:Buffer.from([9])});
test('resolve ALT writable accounts, compute priority fee, never authorize signing',async()=>{
 const raw=encode([
  ComputeBudgetProgram.setComputeUnitLimit({units:250000}),
  ComputeBudgetProgram.setComputeUnitPrice({microLamports:1000000}),
  swap()]);
 const result=await auditEchoUnsignedV0Transaction({
  base64:raw,expectedFeePayer:payer.toBase58(),lookupProvider:provider});
 assert.equal(result.ok,true);
 if(result.ok){
  assert.equal(result.lookupTables,1);
  assert.ok(result.writableAccounts.includes(account.toBase58()));
  assert.ok(result.writableAccounts.includes(payer.toBase58()));
  assert.equal(result.computeUnitLimit,250000);
  assert.equal(result.estimatedPriorityFeeLamports,'250000');
  assert.deepEqual(result.unknownPrograms,[keypair.publicKey.toBase58()]);
  assert.equal(result.signingApproved,false);
  assert.equal(result.tokenDestinationsNotVerified,true);
  assert.equal(result.accountDataAndRentNotVerified,true);
 }
 assert.equal(ECHO_ACCOUNT_AUDIT_GRANTS_SIGNING,false);
});
test('reject excessive compute fee and direct SOL transfer',async()=>{
 const expensive=encode([
  ComputeBudgetProgram.setComputeUnitLimit({units:400000}),
  ComputeBudgetProgram.setComputeUnitPrice({microLamports:2000000}),
  swap()]);
 assert.deepEqual(await auditEchoUnsignedV0Transaction({
  base64:expensive,expectedFeePayer:payer.toBase58(),lookupProvider:provider}),
  {ok:false,reason:'PRIORITY_FEE_EXCEEDS_REVIEW_CEILING',signingApproved:false});
 const send=encode([SystemProgram.transfer({fromPubkey:payer,toPubkey:account,lamports:1000})]);
 assert.deepEqual(await auditEchoUnsignedV0Transaction({
  base64:send,expectedFeePayer:payer.toBase58(),lookupProvider:provider}),
  {ok:false,reason:'DIRECT_SOL_TRANSFER_REQUIRES_INDEPENDENT_REVIEW',signingApproved:false});
});
test('wrong fee payer or missing lookup fail closed before authorization',async()=>{
 const raw=encode([swap()]);
 const wrong=await auditEchoUnsignedV0Transaction({
  base64:raw,expectedFeePayer:Keypair.generate().publicKey.toBase58(),lookupProvider:provider});
 assert.equal(wrong.ok,false);
 const missing=await auditEchoUnsignedV0Transaction({
  base64:raw,expectedFeePayer:payer.toBase58(),lookupProvider:{lookup:async()=>null}});
 assert.deepEqual(missing,{ok:false,reason:'LOOKUP_ACCOUNT_MISSING',signingApproved:false});
});
