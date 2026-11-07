import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import bs58 from 'bs58';
import {Keypair,PublicKey,TransactionInstruction,TransactionMessage,
 VersionedTransaction,SystemProgram} from '@solana/web3.js';
import {reconcileEchoSignerPumpCpiLedger,
 ECHO_CPI_LEDGER_CAN_BROADCAST} from '../src/echo/signerOwnedPumpCpiAccounting.js';
const payer=new PublicKey('8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ');
const recipient=Keypair.generate().publicKey;
const amm=new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const transfer=SystemProgram.transfer({fromPubkey:payer,toPubkey:recipient,lamports:20000000});
const tx=new VersionedTransaction(new TransactionMessage({
 payerKey:payer,recentBlockhash:Keypair.generate().publicKey.toBase58(),
 instructions:[transfer,new TransactionInstruction({programId:amm,keys:[
  {pubkey:payer,isSigner:false,isWritable:true},
  {pubkey:recipient,isSigner:false,isWritable:true}],data:Buffer.from([1])})]
}).compileToV0Message()).serialize();
const sha=createHash('sha256').update(tx).digest('hex');
const parsed=VersionedTransaction.deserialize(tx);
const keys=parsed.message.staticAccountKeys.map(k=>k.toBase58());
const systemIndex=keys.indexOf(SystemProgram.programId.toBase58());
const destIndex=keys.indexOf(recipient.toBase58());
const extra=SystemProgram.transfer({fromPubkey:payer,toPubkey:recipient,lamports:3000000});
const group=[{index:1,instructions:[{
 programIdIndex:systemIndex,accounts:[0,destIndex],data:bs58.encode(extra.data)}]}];
const base={
 unsignedBytes:tx,expectedUnsignedSha256:sha,
 prePayerBalanceLamports:'100000000',
 postSimulatedPayerBalanceLamports:'77000000',
 networkFeeLamports:'5000',innerInstructions:group
};
test('pinned System transfer and inner CPI debit reconcile; still cannot sign',()=>{
 const result=reconcileEchoSignerPumpCpiLedger(base);
 assert.equal(result.ok,true,JSON.stringify(result));
 if(result.ok){
  assert.equal(result.systemDebitFromPayerLamports,'23000000');
  assert.equal(result.conservativeWalletDebitLamports,'23005000');
  assert.equal(result.tokenEffectsProven,false);
  assert.equal(result.manualPhantomSellVerified,false);
  assert.equal(result.signingAllowed,false);
 }
 assert.equal(ECHO_CPI_LEDGER_CAN_BROADCAST,false);
});
test('wallet simulation fee accounted once regardless of snapshot convention',()=>{
 const result=reconcileEchoSignerPumpCpiLedger({
  ...base,postSimulatedPayerBalanceLamports:'76995000'});
 assert.equal(result.ok,true,JSON.stringify(result));
 if(result.ok)assert.equal(result.conservativeWalletDebitLamports,'23005000');
});
test('missing CPI trace, missing funds, altered message, unexplained debit reject',()=>{
 for(const change of [
  {innerInstructions:null},
  {postSimulatedPayerBalanceLamports:'70000000'},
  {prePayerBalanceLamports:'0'},
  {expectedUnsignedSha256:'a'.repeat(64)}
 ]){
  const result=reconcileEchoSignerPumpCpiLedger({...base,...change});
  assert.equal(result.ok,false,JSON.stringify(change));
  assert.equal(result.broadcastAllowed,false);
 }
});
test('unknown payer-funded CPI and bad indexed program reject',()=>{
 const unknown=SystemProgram.allocate({accountPubkey:payer,space:16});
 const variants=[
  [{index:1,instructions:[{
   programIdIndex:systemIndex,accounts:[0],
   data:bs58.encode(unknown.data)}]}],
  [{index:1,instructions:[{
   programIdIndex:999,accounts:[0,destIndex],
   data:bs58.encode(extra.data)}]}],
  [{index:999,instructions:[]}],
  [...group,...group]
 ];
 for(const innerInstructions of variants){
  const result=reconcileEchoSignerPumpCpiLedger({...base,innerInstructions});
  assert.equal(result.ok,false,JSON.stringify(innerInstructions));
 }
});

test('unexplained simulated payer delta reports exact discrepancy without approving trade',()=>{
 const r=reconcileEchoSignerPumpCpiLedger({
  ...base,postSimulatedPayerBalanceLamports:'78000000'
 });
 assert.equal(r.ok,false);
 if(!r.ok){
  assert.equal(r.reason,'UNEXPLAINED_PAYER_LAMPORT_BALANCE_CHANGE');
  assert.deepEqual(r.diagnostic,{
   observedPayerDeltaLamports:'22000000',
   outboundSystemDebitsLamports:'23000000',
   inboundSystemCreditsLamports:'0',
   networkFeeLamports:'5000',
   unexplainedAgainstDebitOnlyLamports:'-1000000',
   unexplainedAgainstNetSystemLamports:'-1000000',
   programInstructionsReviewed:3,
   candidateTokenCloseRefundCount:0,
   candidateTokenCloseFundedLamports:'0'
  });
  assert.equal(r.signingAllowed,false);
  assert.equal(r.broadcastAllowed,false);
 }
});
test('explicit System refund to wallet is counted, never inferred from delta',()=>{
 const credit=SystemProgram.transfer({
  fromPubkey:recipient,toPubkey:payer,lamports:1000000
 });
 const creditCpi={index:1,instructions:[{
  programIdIndex:systemIndex,
  accounts:[destIndex,0],data:bs58.encode(credit.data)
 }]};
 const matched=reconcileEchoSignerPumpCpiLedger({
  ...base,postSimulatedPayerBalanceLamports:'78000000',
  innerInstructions:[...group,{index:0,instructions:creditCpi.instructions}]
 });
 assert.equal(matched.ok,true,JSON.stringify(matched));
 if(matched.ok){
  assert.equal(matched.observedPayerDeltaLamports,'22000000');
  assert.equal(matched.tokenEffectsProven,false);
  assert.equal(matched.signingAllowed,false);
  assert.equal(matched.broadcastAllowed,false);
 }
});
