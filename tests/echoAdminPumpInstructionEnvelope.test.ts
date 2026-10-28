import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {validatePumpLegacyBuyInstruction} from '../src/echo/adminPumpInstructionEnvelope.js';
import {PUMP_CURVE_PROGRAM,PUMP_SWAP_PROGRAM} from '../src/echo/adminPumpVenue.js';
const signer='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const mint='So11111111111111111111111111111111111111112';
const base={programId:PUMP_CURVE_PROGRAM,instructionName:'buy',accounts:[signer,mint],
 signerWallet:signer,mint,maxQuoteLamports:100000000n,baseTokens:1000n,
 finalized:true,rpcTrusted:true};
describe('Echo Pump instruction envelope',()=>{
 it('rejects unknown instruction versions, mismatched accounts and non-finalized transactions',()=>{
  assert.equal(validatePumpLegacyBuyInstruction(base).valid,true);
  for(const patch of [{programId:PUMP_SWAP_PROGRAM},{instructionName:'buy_v3'},
   {accounts:[signer]},{baseTokens:0n},{maxQuoteLamports:0n},
   {finalized:false},{rpcTrusted:false}]){
   assert.equal(validatePumpLegacyBuyInstruction({...base,...patch}).valid,false);
  }
 });
});
