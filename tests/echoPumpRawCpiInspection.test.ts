import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair,PublicKey,ComputeBudgetProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {inspectEchoPumpRawCpi,ECHO_CPI_INSPECTION_SIGNING_ENABLED}
 from '../src/echo/pumpRawCpiInspection.js';
const payer=new PublicKey('8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ');
const tx=new VersionedTransaction(new TransactionMessage({
 payerKey:payer,recentBlockhash:Keypair.generate().publicKey.toBase58(),
 instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:500000})]
}).compileToV0Message()).serialize();
const decoded=VersionedTransaction.deserialize(tx);
const accounts=decoded.message.staticAccountKeys.map(a=>a.toBase58());
const hash=createHash('sha256').update(tx).digest('hex');
function snapshot(){
 return {exactUnsignedSha256:hash,simulationErr:null,contextSlot:123456,
  accountKeys:accounts,preBalances:accounts.map(()=>100000000),
  postBalances:accounts.map(()=>90000000),
  innerInstructions:[] as unknown};
}
test('raw complete simulation structure is observational only, never CPI authorization',()=>{
 const r=inspectEchoPumpRawCpi({unsignedBytes:tx,simulation:snapshot()});
 assert.deepEqual(r,{ok:true,mode:'INNER_INSTRUCTION_STRUCTURE_ONLY',
  unsignedSha256:hash,innerInstructionCount:0,contextSlot:123456,
  completeWalletDebitProven:false,signingAllowed:false,broadcastAllowed:false});
 assert.equal(ECHO_CPI_INSPECTION_SIGNING_ENABLED,false);
});
test('missing inner instructions, balances, or mismatch fails closed',()=>{
 for(const patch of [
  {innerInstructions:null},{preBalances:null},{postBalances:[]},
  {postBalances:accounts.map(()=>100000000)},
  {innerInstructions:[{index:0,instructions:[{programIdIndex:0,accounts:[],data:'0'}]}]},
  {accountKeys:[...accounts].reverse()},{contextSlot:0},
  {simulationErr:{InstructionError:[0,'InvalidAccountData']}},
  {exactUnsignedSha256:'f'.repeat(64)},
  {innerInstructions:[{index:0,instructions:[{programIdIndex:999,accounts:[],data:'2'}]}]},
  {innerInstructions:[{index:999,instructions:[]}]},
  {innerInstructions:[{index:0,instructions:[]},{index:0,instructions:[]}]}
 ]){
  const r=inspectEchoPumpRawCpi({unsignedBytes:tx,simulation:{...snapshot(),...patch}});
  assert.equal(r.ok,false,JSON.stringify(patch));
  assert.equal(r.broadcastAllowed,false);
 }
});
