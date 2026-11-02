import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateKey,sign as edSign} from 'node:crypto';
import {Keypair} from '@solana/web3.js';
import {verifyEchoConfiguredWalletCustody,
 ECHO_CONFIGURED_WALLET_PROOF_ENABLES_TRADING}
 from '../src/echo/configuredCustodyProof.js';
import type {EchoCustodyProofProvider} from '../src/echo/isolatedCustodyProbe.js';
import {ECHO_EXPECTED_EXECUTION_WALLET} from '../src/echo/executionWallet.js';
const mock=Keypair.generate();
const der=Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),
 Buffer.from(mock.secretKey.slice(0,32))]);
const secret=createPrivateKey({key:der,format:'der',type:'pkcs8'});
const signer:EchoCustodyProofProvider={
 publicWallet:mock.publicKey.toBase58(),
 signOwnershipMessage:async text=>new Uint8Array(edSign(null,Buffer.from(text),secret))
};
test('production custody cannot be asserted using unrelated valid mock key',async()=>{
 const r=await verifyEchoConfiguredWalletCustody(signer,1800000000000);
 assert.deepEqual(r,{verified:false,reason:'SIGNER_IDENTITY_MISMATCH',
  executionAuthorized:false});
 assert.notEqual(mock.publicKey.toBase58(),ECHO_EXPECTED_EXECUTION_WALLET);
 assert.equal(ECHO_CONFIGURED_WALLET_PROOF_ENABLES_TRADING,false);
});
test('a forged public-wallet label cannot pass challenge with another key',async()=>{
 const forged={...signer,publicWallet:ECHO_EXPECTED_EXECUTION_WALLET};
 const r=await verifyEchoConfiguredWalletCustody(forged,1800000000000);
 assert.deepEqual(r,{verified:false,reason:'SIGNATURE_PROOF_FAILED',
  executionAuthorized:false});
});
test('signer outages fail closed and cannot authorize trading',async()=>{
 const bad:EchoCustodyProofProvider={
  publicWallet:ECHO_EXPECTED_EXECUTION_WALLET,
  signOwnershipMessage:async()=>{throw Error('unavailable');}
 };
 const r=await verifyEchoConfiguredWalletCustody(bad,1800000000000);
 assert.equal(r.verified,false);assert.equal(r.executionAuthorized,false);
});
