import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { interpretSignatureStatus } from '../src/echo/adminSolanaSignatureEvidence.js';
describe('Echo Solana signature evidence',()=>{
 it('recognizes finalized success only from trusted caught-up RPC',()=>{
  assert.equal(interpretSignatureStatus({confirmationStatus:'finalized',err:null,slot:123},true,true).finalizedSuccess,true);
  assert.equal(interpretSignatureStatus({confirmationStatus:'finalized',err:null,slot:123},false,true).authoritative,false);
  assert.equal(interpretSignatureStatus({confirmationStatus:'finalized',err:null,slot:123},true,false).authoritative,false);
 });
 it('does not infer failure from missing or non-finalized status',()=>{
  for(const status of [null,{confirmationStatus:'confirmed' as const,err:null,slot:123},
   {confirmationStatus:'finalized' as const,slot:123},
   {confirmationStatus:'finalized' as const,err:null,slot:NaN}]){
   assert.equal(interpretSignatureStatus(status,true,true).authoritative,false);
  }
 });
 it('recognizes finalized transaction errors but does not authorize retries',()=>{
  const r=interpretSignatureStatus({confirmationStatus:'finalized',err:{InstructionError:[0,'Custom']},slot:123},true,true);
  assert.equal(r.finalizedFailure,true);
  assert.equal(r.finalizedSuccess,false);
 });
});
