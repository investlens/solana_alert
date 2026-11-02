import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateKey,sign as edSign} from 'node:crypto';
import {Keypair,ComputeBudgetProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {verifySignedBuyDryRunInBoundary,dryRunEchoActualWalletBuyNoBroadcast,
 ECHO_SIGNED_BUY_DRY_RUN_BROADCAST_ENABLED,ECHO_SIGNED_BUY_DRY_RUN_AUTHORISES_LIVE_BUY}
 from '../src/echo/offlineSignedBuyDryRun.js';
const mock=Keypair.generate();
const privateDer=Buffer.concat([
 Buffer.from('302e020100300506032b657004220420','hex'),
 Buffer.from(mock.secretKey.slice(0,32))
]);
const testKey=createPrivateKey({key:privateDer,format:'der',type:'pkcs8'});
const message=new TransactionMessage({
 payerKey:mock.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),
 instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:120000})]
}).compileToV0Message().serialize();
function signer(publicWallet=mock.publicKey.toBase58(),tamper=false){
 let calls=0;
 return {provider:{
  publicWallet,
  signTransactionMessageForDryRun:async (raw:Uint8Array)=>{
   calls++;
   const signed=new Uint8Array(edSign(null,Buffer.from(raw),testKey));
   if(tamper)signed[0]^=1;
   return signed;
  }
 },calls:()=>calls};
}
test('ephemeral test wallet signs a message in isolation; outputs no signature/bytes',async()=>{
 const f=signer();
 const result=await verifySignedBuyDryRunInBoundary({
  wallet:mock.publicKey.toBase58(),signer:f.provider,message
 });
 assert.equal(result.ok,true);
 assert.equal(f.calls(),1);
 assert.equal(JSON.stringify(result).includes(Buffer.from(message).toString('base64')),false);
 assert.equal(Object.keys(result).includes('signature'),false);
 assert.equal(ECHO_SIGNED_BUY_DRY_RUN_BROADCAST_ENABLED,false);
 assert.equal(ECHO_SIGNED_BUY_DRY_RUN_AUTHORISES_LIVE_BUY,false);
 if(result.ok){
  assert.equal(result.signatureDiscarded,true);
  assert.equal(result.broadcastAllowed,false);
 }
});
test('invalid signer, tampered signature and unavailable signer fail closed',async()=>{
 const foreign=Keypair.generate().publicKey.toBase58();
 const wrong=signer(foreign);
 assert.deepEqual(await verifySignedBuyDryRunInBoundary({
  wallet:mock.publicKey.toBase58(),signer:wrong.provider,message
 }),{ok:false,reason:'SIGNER_IDENTITY_OR_MESSAGE_INVALID',broadcastAllowed:false});
 assert.equal(wrong.calls(),0);
 const corrupted=signer(mock.publicKey.toBase58(),true);
 const result=await verifySignedBuyDryRunInBoundary({
  wallet:mock.publicKey.toBase58(),signer:corrupted.provider,message
 });
 assert.deepEqual(result,{ok:false,reason:'SIGNATURE_MISMATCH',broadcastAllowed:false});
 const unavailable=await verifySignedBuyDryRunInBoundary({
  wallet:mock.publicKey.toBase58(),
  signer:{publicWallet:mock.publicKey.toBase58(),
   signTransactionMessageForDryRun:async()=>{throw Error('hardware offline');}},
  message
 });
 assert.deepEqual(unavailable,{ok:false,reason:'SIGNER_UNAVAILABLE',broadcastAllowed:false});
});
test('a generated key cannot pass the real Echo signer gate or request a real signing attempt',async()=>{
 const f=signer();
 const messageBytes=new VersionedTransaction(new TransactionMessage({
  payerKey:mock.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),
  instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:120000})]
 }).compileToV0Message()).serialize();
 const result=await dryRunEchoActualWalletBuyNoBroadcast({
  signer:f.provider,
  request:{audience:'echo-isolated-signer',action:'BUY',
   executionWallet:'8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ',
   mint:'2'.repeat(44),reservationKey:'none',transactionSha256:'a'.repeat(64),
   nonceHex:'b'.repeat(64),issuedAtMs:1800000000000,expiresAtMs:1800000010000},
  coordinatorSignatureBase58:'not signed',coordinatorPublicKey:mock.publicKey.toBase58(),
  nowMs:1800000000000,unsignedTransactionBytes:messageBytes,
  nonceStore:{consumeOnce:async()=>true},
  reservationReader:{getByWalletAndMint:async()=>null},
  preview:{ok:false,reason:'NOT_SIMULATED'}
 });
 assert.deepEqual(result,{ok:false,reason:'PINNED_BUY_WALLET_REQUIRED',broadcastAllowed:false});
 assert.equal(f.calls(),0);
});
