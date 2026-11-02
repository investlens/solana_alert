import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import {createEchoSealedCustodyProofOnly,proveEchoPinnedSealedCustodyFromEnv,
 ECHO_SEALED_CUSTODY_TRANSACTION_SIGNING_ENABLED}
 from '../src/echo/isolatedSealedCustodyProof.js';
import {probeEchoSignerCustody} from '../src/echo/isolatedCustodyProbe.js';
const wallet=Keypair.generate();
const secretBase58=bs58.encode(wallet.secretKey);
const now=1800000000000;
const config={secretBase58,expectedWallet:wallet.publicKey.toBase58(),
 mode:'PROOF_ONLY',broadcastEnabled:'false',requestsEnabled:'false',clock:()=>now};
test('dedicated synthetic sealed wallet passes fresh off-chain ownership challenge',async()=>{
 const setup=createEchoSealedCustodyProofOnly(config);
 assert.equal(setup.ok,true);
 if(!setup.ok)throw Error('expected valid fixture');
 const result=await probeEchoSignerCustody({
  provider:setup.provider,expectedWallet:wallet.publicKey.toBase58(),
  audience:'echo-isolated-signer',nowMs:now
 });
 assert.deepEqual(result,{verified:true,wallet:wallet.publicKey.toBase58()});
 assert.equal(setup.transactionSigningAllowed,false);
 assert.equal(ECHO_SEALED_CUSTODY_TRANSACTION_SIGNING_ENABLED,false);
 assert.equal(JSON.stringify(setup).includes(secretBase58),false);
 // A raw Solana transaction/message must NEVER be signed by the proof-only adapter.
 await assert.rejects(
  setup.provider.signOwnershipMessage(new Uint8Array(200).fill(42)),
  /OFFCHAIN_WALLET_CHALLENGE_ONLY/
 );
});
test('wrong-wallet secret and loose-mode flags refuse proof adapter',()=>{
 for(const patch of [
  {expectedWallet:'8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ'},
  {mode:'EXECUTE'},
  {broadcastEnabled:'true'},
  {requestsEnabled:'true'},
  {secretBase58:undefined}
 ]){
  const result=createEchoSealedCustodyProofOnly({...config,...patch});
  assert.equal(result.ok,false);
  assert.equal(result.transactionSigningAllowed,false);
 }
});
test('no actual Echo key available: real pinned custody must remain unverified',async()=>{
 const result=await proveEchoPinnedSealedCustodyFromEnv({
  ECHO_SIGNER_MODE:'PROOF_ONLY',
  ECHO_SIGNER_BROADCAST_ENABLED:'false',
  ECHO_SIGNER_REQUESTS_ENABLED:'false',
  ECHO_SIGNER_EXPECTED_WALLET:'8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ'
 },now);
 assert.equal(result,'UNPROVISIONED');
});
