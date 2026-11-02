import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ComputeBudgetProgram,Keypair,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {verifyEchoSignedMessage} from '../src/echo/signedMessageAttestation.js';
const signer=Keypair.generate();
const msg=new TransactionMessage({
 payerKey:signer.publicKey,
 recentBlockhash:Keypair.generate().publicKey.toBase58(),
 instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:120_000})]
}).compileToV0Message();
const unsignedHash=createHash('sha256').update(msg.serialize()).digest('hex');
const tx=new VersionedTransaction(msg);
tx.sign([signer]);
const signed=Buffer.from(tx.serialize()).toString('base64');
const base={signedTransactionBase64:signed,approvedMessageSha256:unsignedHash,
 expectedFeePayer:signer.publicKey.toBase58()};
test('valid Ed25519 transaction signature must match exact preapproved message',()=>{
 const r=verifyEchoSignedMessage(base);
 assert.equal(r.ok,true);
 if(r.ok){
  assert.equal(r.messageSha256,unsignedHash);
  assert.equal(r.feePayer,base.expectedFeePayer);
  assert.equal(r.broadcastAllowed,false);
 }
});
test('modified message, wrong payer and forged signature all fail cryptographically',()=>{
 const fakeHash={...base,approvedMessageSha256:'a'.repeat(64)};
 assert.deepEqual(verifyEchoSignedMessage(fakeHash),
  {ok:false,reason:'APPROVED_MESSAGE_MISMATCH',broadcastAllowed:false});
 const wrongWallet={...base,expectedFeePayer:Keypair.generate().publicKey.toBase58()};
 assert.equal(verifyEchoSignedMessage(wrongWallet).ok,false);
 const tampered=VersionedTransaction.deserialize(Buffer.from(signed,'base64'));
 tampered.signatures[0][5]^=1;
 const altered={...base,signedTransactionBase64:Buffer.from(tampered.serialize()).toString('base64')};
 assert.deepEqual(verifyEchoSignedMessage(altered),{ok:false,
  reason:'SIGNATURE_CRYPTOGRAPHICALLY_INVALID',broadcastAllowed:false});
});
test('unsigned transaction cannot pass even with correct approved hash',()=>{
 const raw=new VersionedTransaction(msg);
 const r=verifyEchoSignedMessage({...base,signedTransactionBase64:Buffer.from(raw.serialize()).toString('base64')});
 assert.equal(r.ok,false);
 assert.equal(r.broadcastAllowed,false);
});
