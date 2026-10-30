import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateKey,sign as ed25519Sign} from 'node:crypto';
import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import {makeEchoWalletOwnershipMessage,verifyEchoWalletChallengeSignature,
 verifyEchoWalletOwnershipProof,ECHO_WALLET_CHALLENGE_DOMAIN} from '../src/echo/walletOwnershipProof.js';
const wallet=Keypair.generate(), now=1800000000000;
const challenge={wallet:wallet.publicKey.toBase58(),nonceHex:'a'.repeat(64),
 issuedAtMs:now-1000,expiresAtMs:now+60000,audience:'echo-trading-executor'};
const seed=Buffer.from(wallet.secretKey.slice(0,32));
const pkcs8=Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]);
const key=createPrivateKey({key:pkcs8,format:'der',type:'pkcs8'});
const signature=bs58.encode(ed25519Sign(null,
 Buffer.from(makeEchoWalletOwnershipMessage(challenge)),key));
test('valid Ed25519 public-key proof verifies signed domain-bound challenge',()=>{
 assert.equal(makeEchoWalletOwnershipMessage(challenge).startsWith(ECHO_WALLET_CHALLENGE_DOMAIN),true);
 assert.equal(verifyEchoWalletChallengeSignature(challenge,signature),true);
 assert.equal(verifyEchoWalletChallengeSignature({...challenge,nonceHex:'b'.repeat(64)},signature),false);
 assert.equal(verifyEchoWalletChallengeSignature({...challenge,audience:'other-executor'},signature),false);
});
test('expected production wallet cannot be spoofed by unrelated owner, even with valid signature',()=>{
 assert.equal(verifyEchoWalletOwnershipProof({
  challenge,signatureBase58:signature,nowMs:now,
  expectedAudience:'echo-trading-executor',nonceAlreadyConsumed:false
 }),false);
 assert.equal(verifyEchoWalletOwnershipProof({
  challenge,signatureBase58:signature,nowMs:now,
  expectedAudience:'echo-trading-executor',nonceAlreadyConsumed:true
 }),false);
});
