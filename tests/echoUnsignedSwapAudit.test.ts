import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,ComputeBudgetProgram,SystemProgram,TransactionMessage,TransactionInstruction,VersionedTransaction,PublicKey} from '@solana/web3.js';
import {auditEchoUnsignedSwap} from '../src/echo/unsignedSwapAudit.js';
const wallet=Keypair.generate().publicKey;
const JUPITER=new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
const jupiterIx=new TransactionInstruction({programId:JUPITER,keys:[],data:Buffer.from([1])});
function build(instructions:TransactionInstruction[],payer=wallet){
 const msg=new TransactionMessage({payerKey:payer,
  recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions}).compileToV0Message();
 return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
}
test('valid fee-limited unsigned swap exposes static accounts but never authorizes signing',()=>{
 const encoded=build([
  ComputeBudgetProgram.setComputeUnitLimit({units:600_000}),
  ComputeBudgetProgram.setComputeUnitPrice({microLamports:100_000}),
  jupiterIx
 ]);
 const result=auditEchoUnsignedSwap(encoded,wallet.toBase58());
 assert.equal(result.ok,true);
 if(result.ok){
  assert.equal(result.audit.requiredSignatures,1);
  assert.equal(result.audit.lookupTables,0);
  assert.equal(result.audit.computeUnitLimit,600_000);
  assert.equal(result.audit.worstCasePriorityFeeLamports,'60000');
  assert.equal(result.audit.feeEstimateComplete,true);
  assert.equal(result.audit.signingApproved,false);
  assert.match(result.audit.sha256,/^[a-f0-9]{64}$/);
  assert.ok(result.audit.writableAccounts.includes(wallet.toBase58()));
 }
});
test('unexpected fee-payer, direct SOL transfer, unknown programs, duplicate Jupiter swaps rejected',()=>{
 const encoded=build([jupiterIx]);
 assert.deepEqual(auditEchoUnsignedSwap(encoded,Keypair.generate().publicKey.toBase58()),{ok:false,reason:'UNEXPECTED_FEE_PAYER'});
 const transfer=build([SystemProgram.transfer({fromPubkey:wallet,toPubkey:Keypair.generate().publicKey,lamports:1}),jupiterIx]);
 assert.deepEqual(auditEchoUnsignedSwap(transfer,wallet.toBase58()),{ok:false,reason:'UNREVIEWED_SOL_TRANSFER'});
 const unknown=build([new TransactionInstruction({programId:Keypair.generate().publicKey,keys:[],data:Buffer.alloc(0)}),jupiterIx]);
 assert.deepEqual(auditEchoUnsignedSwap(unknown,wallet.toBase58()),{ok:false,reason:'UNREVIEWED_PROGRAM'});
 assert.deepEqual(auditEchoUnsignedSwap(build([jupiterIx,jupiterIx]),wallet.toBase58()),{ok:false,reason:'NO_UNIQUE_JUPITER_SWAP'});
});
test('overpriced priority fees, too many compute units and nonzero signatures rejected',()=>{
 const tooExpensive=build([ComputeBudgetProgram.setComputeUnitPrice({microLamports:2_000_001}),jupiterIx]);
 assert.deepEqual(auditEchoUnsignedSwap(tooExpensive,wallet.toBase58()),{ok:false,reason:'PRIORITY_PRICE_EXCEEDED'});
 const overBudget=build([ComputeBudgetProgram.setComputeUnitLimit({units:1_400_001}),jupiterIx]);
 assert.deepEqual(auditEchoUnsignedSwap(overBudget,wallet.toBase58()),{ok:false,reason:'COMPUTE_LIMIT_EXCEEDED'});
 const realSignature=VersionedTransaction.deserialize(Buffer.from(build([jupiterIx]),'base64'));
 realSignature.signatures[0][0]=1;
 assert.deepEqual(auditEchoUnsignedSwap(Buffer.from(realSignature.serialize()).toString('base64'),wallet.toBase58()),
  {ok:false,reason:'UNTRUSTED_SIGNERS'});
});
test('missing priority price is explicitly incomplete, never a signing approval',()=>{
 const result=auditEchoUnsignedSwap(build([ComputeBudgetProgram.setComputeUnitLimit({units:100_000}),jupiterIx]),wallet.toBase58());
 assert.equal(result.ok,true);
 if(result.ok){
  assert.equal(result.audit.feeEstimateComplete,false);
  assert.equal(result.audit.worstCasePriorityFeeLamports,null);
  assert.equal(result.audit.signingApproved,false);
 }
});
