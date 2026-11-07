import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair,PublicKey,VersionedTransaction,TransactionMessage,
 TransactionInstruction,SystemProgram} from '@solana/web3.js';
import {normalizeSignerSimulationCpi} from '../src/echo/normalizeSignerSimulationCpi.js';
import {reconcileEchoSignerPumpCpiLedger}
 from '../src/echo/signerOwnedPumpCpiAccounting.js';
const wallet=new PublicKey('8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ');
const dest=Keypair.generate().publicKey;
const token=new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const swap=new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const tx=new VersionedTransaction(new TransactionMessage({
 payerKey:wallet,recentBlockhash:Keypair.generate().publicKey.toBase58(),
 instructions:[
  SystemProgram.transfer({fromPubkey:wallet,toPubkey:dest,lamports:20000000}),
  new TransactionInstruction({programId:swap,keys:[
   {pubkey:wallet,isSigner:false,isWritable:true},
   {pubkey:dest,isSigner:false,isWritable:true},
   {pubkey:token,isSigner:false,isWritable:false}],data:Buffer.from([9])})
 ]
}).compileToV0Message());
const bytes=tx.serialize();
const sha=createHash('sha256').update(bytes).digest('hex');
const compiled=tx.message.staticAccountKeys.map(k=>k.toBase58());
const parsedCpi=[{index:1,instructions:[
 {program:'system',programId:SystemProgram.programId.toBase58(),parsed:{
  type:'transfer',info:{source:wallet.toBase58(),
   destination:dest.toBase58(),lamports:3000000}}},
 {program:'spl-token',programId:token.toBase58(),parsed:{
  type:'transferChecked',info:{source:dest.toBase58(),
   destination:wallet.toBase58(),mint:token.toBase58(),
   tokenAmount:{amount:'7',decimals:6}}}}
]}];
test('normalize realistic parsed System plus token CPI; SOL debits stay exact',()=>{
 const result=normalizeSignerSimulationCpi(parsedCpi,tx);
 assert.equal(result[0].instructions.length,2);
 assert.equal(result[0].instructions[1].opaqueParsedNonSystem,true);
 const ledger=reconcileEchoSignerPumpCpiLedger({
  unsignedBytes:bytes,expectedUnsignedSha256:sha,
  prePayerBalanceLamports:'100000000',
  postSimulatedPayerBalanceLamports:'77000000',
  networkFeeLamports:'5000',innerInstructions:result
 });
 assert.equal(ledger.ok,true,JSON.stringify(ledger));
 if(ledger.ok){
  assert.equal(ledger.conservativeWalletDebitLamports,'23005000');
  assert.equal(ledger.tokenEffectsProven,false);
  assert.equal(ledger.signingAllowed,false);
  assert.equal(ledger.broadcastAllowed,false);
 }
});
test('partially decoded account addresses bind to exact message keys',()=>{
 const result=normalizeSignerSimulationCpi([{index:1,instructions:[{
  programId:token.toBase58(),accounts:[wallet.toBase58(),dest.toBase58()],
  data:'2'
 }]}],tx);
 assert.equal(result[0].instructions[0].programIdIndex,compiled.indexOf(token.toBase58()));
 assert.deepEqual(result[0].instructions[0].accounts,[0,compiled.indexOf(dest.toBase58())]);
});
test('reject forged addresses, unknown System operations and unknown parsed programs',()=>{
 const fake=Keypair.generate().publicKey.toBase58();
 for(const raw of [
  [{index:1,instructions:[{programId:SystemProgram.programId.toBase58(),
   parsed:{type:'withdraw',info:{source:wallet.toBase58(),
    destination:dest.toBase58(),lamports:1}}}]}],
  [{index:1,instructions:[{programId:token.toBase58(),accounts:[fake],data:'2'}]}],
  [{index:1,instructions:[{programId:fake,parsed:{type:'transfer',
   info:{source:wallet.toBase58()}}}]}],
  [{index:1,instructions:[{programId:SystemProgram.programId.toBase58(),
   parsed:{type:'transfer',info:{source:fake,
    destination:dest.toBase58(),lamports:1}}}]}],
  [{index:1,instructions:[{programId:SystemProgram.programId.toBase58(),
   parsed:{type:'transfer',info:{source:wallet.toBase58(),
    destination:dest.toBase58(),lamports:-1}}}]}]
 ]) assert.throws(()=>normalizeSignerSimulationCpi(raw,tx));
});
test('opaque marker cannot conceal a System payer debit',()=>{
 const systemIndex=compiled.indexOf(SystemProgram.programId.toBase58());
 const ledger=reconcileEchoSignerPumpCpiLedger({
  unsignedBytes:bytes,expectedUnsignedSha256:sha,
  prePayerBalanceLamports:'100000000',
  postSimulatedPayerBalanceLamports:'80000000',
  networkFeeLamports:'5000',
  innerInstructions:[{index:1,instructions:[{
   programIdIndex:systemIndex,accounts:[],data:'',opaqueParsedNonSystem:true
  }]}]
 });
 assert.equal(ledger.ok,false);
});

test('candidate parsed token CloseAccount refund is identified but never guessed as wallet credit',()=>{
 const raw=[{index:1,instructions:[
  {program:'spl-token',programId:token.toBase58(),parsed:{
   type:'closeAccount',info:{account:dest.toBase58(),
    destination:wallet.toBase58(),authority:wallet.toBase58()}}}
 ]}];
 const normalized=normalizeSignerSimulationCpi(raw,tx);
 assert.equal(normalized[0].instructions[0].closesAccountToPayer,true);
 assert.equal(normalized[0].instructions[0].closedAccountIndex,
  compiled.indexOf(dest.toBase58()));
 const ledger=reconcileEchoSignerPumpCpiLedger({
  unsignedBytes:bytes,expectedUnsignedSha256:sha,
  prePayerBalanceLamports:'100000000',
  postSimulatedPayerBalanceLamports:'81000000',
  networkFeeLamports:'5000',innerInstructions:normalized
 });
 assert.equal(ledger.ok,false);
 if(!ledger.ok){
  assert.equal(ledger.reason,'UNEXPLAINED_PAYER_LAMPORT_BALANCE_CHANGE');
  assert.equal(ledger.diagnostic?.candidateTokenCloseRefundCount,1);
  assert.equal(ledger.diagnostic?.candidateTokenCloseFundedLamports,'20000000');
  assert.equal(ledger.broadcastAllowed,false);
 }
});
test('token close to a different destination never becomes candidate payer refund',()=>{
 const raw=[{index:1,instructions:[
  {programId:token.toBase58(),parsed:{
   type:'closeAccount',info:{account:dest.toBase58(),
    destination:dest.toBase58(),authority:wallet.toBase58()}}}
 ]}];
 const normalized=normalizeSignerSimulationCpi(raw,tx);
 assert.equal(normalized[0].instructions[0].closesAccountToPayer,undefined);
});
