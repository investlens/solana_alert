import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSignerBoundary, type SignerRequest } from '../src/echo/adminSignerBoundary.js';
const base: SignerRequest = {
  requestId:'shadow-1', authenticatedService:true, adminApprovedDeployment:true,
  wallet:'wallet', intentWallet:'wallet', transactionWallet:'wallet',
  intentMint:'mint', transactionMint:'mint', intentState:'reserved',
  amountLamports:100_000_000, maxAmountLamports:100_000_000,
  feeLamports:1000, maxFeeLamports:5000, allowedProgramIds:['approved'],
  transactionProgramIds:['approved'], transactionHashMatchesApprovedQuote:true,
  simulationPassed:true, emergencyStop:false,
};
describe('Echo signer boundary',()=>{
  it('never authorizes real signing, even with ideal inputs',()=>{
    assert.deepEqual(evaluateSignerBoundary(base),{
      allowed:false,reason:'LIVE_SIGNING_NOT_IMPLEMENTED_OR_AUTHORIZED',
    });
  });
  it('denies unauthorized requests and altered instructions',()=>{
    const cases: Partial<SignerRequest>[] = [
      {authenticatedService:false},{adminApprovedDeployment:false},{emergencyStop:true},
      {wallet:'other'},{transactionWallet:'other'},{transactionMint:'other'},
      {intentState:'submitted'},{amountLamports:100_000_001},{amountLamports:0},
      {amountLamports:NaN},{feeLamports:5001},{transactionProgramIds:['unapproved']},
      {transactionProgramIds:[]},{transactionHashMatchesApprovedQuote:false},
      {simulationPassed:false},
    ];
    for(const patch of cases){
      const result=evaluateSignerBoundary({...base,...patch});
      assert.equal(result.allowed,false);
      assert.notEqual(result.reason,'LIVE_SIGNING_NOT_IMPLEMENTED_OR_AUTHORIZED',JSON.stringify(patch));
    }
  });
});
