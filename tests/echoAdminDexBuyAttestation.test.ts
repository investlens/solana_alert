import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {verifyEchoDexBuyAttestation} from '../src/echo/adminDexBuyAttestation.js';
const valid={parserTrusted:true,parserVersion:'reviewed-v1',rpcTrusted:true,
 finalized:true,signature:'2'.repeat(64),
 callerWallet:'5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',
 mint:'So11111111111111111111111111111111111111112',
 verifiedSigner:true,swapProgramVerified:true,exactInputDebited:true,
 exactOutputCredited:true,routedSwapVerified:true,transferOnly:false,ageSeconds:10};
describe('Echo DEX BUY attestation boundary',()=>{
 it('requires every independently verified swap property',()=>{
  assert.equal(verifyEchoDexBuyAttestation(valid).verified,true);
  for(const patch of [{parserTrusted:false},{swapProgramVerified:false},
   {exactInputDebited:false},{exactOutputCredited:false},
   {routedSwapVerified:false},{transferOnly:true},{finalized:false},
   {ageSeconds:120},{verifiedSigner:false}]){
   assert.equal(verifyEchoDexBuyAttestation({...valid,...patch}).verified,false);
  }
 });
});
