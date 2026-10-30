import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateKey,sign as signEd25519} from 'node:crypto';
import {Keypair} from '@solana/web3.js';
import {probeEchoSignerCustody,ECHO_SIGNER_TRANSACTION_SIGNING_ENABLED,
 type EchoCustodyProofProvider} from '../src/echo/isolatedCustodyProbe.js';
const keypair=Keypair.generate();
const pkcs8=Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(keypair.secretKey.slice(0,32))]);
const privateKey=createPrivateKey({key:pkcs8,format:'der',type:'pkcs8'});
const provider:EchoCustodyProofProvider={
 publicWallet:keypair.publicKey.toBase58(),
 signOwnershipMessage:async m=>new Uint8Array(signEd25519(null,Buffer.from(m),privateKey))
};
test('isolated custody provider can sign ephemeral off-chain challenge',async()=>{
 const outcome=await probeEchoSignerCustody({
  provider,expectedWallet:keypair.publicKey.toBase58(),
  audience:'echo-isolated-signer',nowMs:1800000000000});
 assert.deepEqual(outcome,{verified:true,wallet:keypair.publicKey.toBase58()});
 assert.equal(ECHO_SIGNER_TRANSACTION_SIGNING_ENABLED,false);
});
test('mismatched wallet, broken key and signer outage deny custody proof',async()=>{
 const base={provider,expectedWallet:Keypair.generate().publicKey.toBase58(),
  audience:'echo-isolated-signer',nowMs:1800000000000};
 assert.deepEqual(await probeEchoSignerCustody(base),
  {verified:false,reason:'SIGNER_IDENTITY_MISMATCH'});
 const broken:EchoCustodyProofProvider={publicWallet:provider.publicWallet,
  signOwnershipMessage:async()=>new Uint8Array(64)};
 assert.deepEqual(await probeEchoSignerCustody({...base,provider:broken,
  expectedWallet:provider.publicWallet}),{verified:false,reason:'SIGNATURE_PROOF_FAILED'});
 const unavailable:EchoCustodyProofProvider={publicWallet:provider.publicWallet,
  signOwnershipMessage:async()=>{throw new Error('unavailable')}};
 assert.deepEqual(await probeEchoSignerCustody({...base,provider:unavailable,
  expectedWallet:provider.publicWallet}),{verified:false,reason:'SIGNER_UNAVAILABLE'});
});
