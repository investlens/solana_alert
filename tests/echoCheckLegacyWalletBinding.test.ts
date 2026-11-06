import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import {checkEchoLegacyKeyBinding} from '../scripts/echoCheckLegacyWalletBinding.js';
const key=Keypair.generate();
const encoded=bs58.encode(key.secretKey);
const at=1800000000000;
test('local legacy key proof returns only MATCH, never the secret or signature',async()=>{
 const result=await checkEchoLegacyKeyBinding({
  secretBase58:encoded,expectedWallet:key.publicKey.toBase58(),nowMs:at});
 assert.deepEqual(result,{status:'MATCH',authorizesTrading:false});
 assert.equal(JSON.stringify(result).includes(encoded),false);
 assert.equal(JSON.stringify(result).includes(key.publicKey.toBase58()),false);
});
test('mismatched key cannot claim custody of pinned trading wallet',async()=>{
 const result=await checkEchoLegacyKeyBinding({
  secretBase58:encoded,
  expectedWallet:'8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ',
  nowMs:at});
 assert.deepEqual(result,{status:'MISMATCH',authorizesTrading:false});
});
test('missing, malformed and corrupted keys fail closed, never authorize spending',async()=>{
 for(const secretBase58 of [undefined,'', 'invalid-key',bs58.encode(key.secretKey.slice(0,32))]){
  const result=await checkEchoLegacyKeyBinding({
   secretBase58,expectedWallet:key.publicKey.toBase58(),nowMs:at});
  assert.deepEqual(result,{status:'UNAVAILABLE',authorizesTrading:false});
 }
});
