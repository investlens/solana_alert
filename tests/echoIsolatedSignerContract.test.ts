import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey,TransactionMessage,VersionedTransaction,ComputeBudgetProgram,SystemProgram} from '@solana/web3.js';
import {inspectEchoUnsignedEnvelope,reviewEchoSignerRequest,ECHO_SIGNER_ENABLED} from '../src/echo/isolatedSignerContract.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint='So11111111111111111111111111111111111111112';
function makeEnvelope(instructions=[ComputeBudgetProgram.setComputeUnitLimit({units:100000})]){
 const msg=new TransactionMessage({payerKey:new PublicKey(wallet),
  recentBlockhash:'11111111111111111111111111111111',instructions}).compileToV0Message();
 return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
}
const good={executionWallet:wallet,mint,reservationKey:wallet+':'+mint,
 unsignedTransactionBase64:makeEnvelope(),simulationVerified:true,
 destinationAndProgramsVerified:true,freshQuoteVerified:true};
test('unsigned envelope is decoded and checked but is never signing permission',()=>{
 assert.deepEqual(inspectEchoUnsignedEnvelope(good),{ok:true});
 assert.deepEqual(reviewEchoSignerRequest(good),
  {ok:false,reason:'INDEPENDENT_VERIFICATION_AND_SIGNER_NOT_INTEGRATED'});
 assert.equal(ECHO_SIGNER_ENABLED,false);
});
test('invalid, spoofed or direct SOL-transfer payloads are denied',()=>{
 for(const overrides of [{executionWallet:'4'.repeat(44)},{reservationKey:'other'},
   {unsignedTransactionBase64:'A'.repeat(200)},
   {unsignedTransactionBase64:'not-base64'}])
   assert.equal(inspectEchoUnsignedEnvelope({...good,...overrides}).ok,false);
 const transfer=makeEnvelope([SystemProgram.transfer({
   fromPubkey:new PublicKey(wallet),toPubkey:new PublicKey(mint),lamports:1000
 })]);
 assert.deepEqual(inspectEchoUnsignedEnvelope({...good,unsignedTransactionBase64:transfer}),
   {ok:false,reason:'UNEXPECTED_SOL_TRANSFER'});
});
test('caller-supplied booleans cannot enable signing',()=>{
 for(const overrides of [
  {simulationVerified:false},{destinationAndProgramsVerified:false},
  {freshQuoteVerified:false}
 ])assert.equal(reviewEchoSignerRequest({...good,...overrides}).ok,false);
});
