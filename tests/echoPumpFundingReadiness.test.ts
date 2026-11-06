import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPumpFundingReadiness,ECHO_FUNDING_READINESS_AUTHORISES_FUNDING,
 type PumpFundingEvidence} from '../src/echo/pumpFundingReadiness.js';
function diagnostic(changes:Partial<PumpFundingEvidence>={}):PumpFundingEvidence{
 return {principalLamports:'25000000',networkFeeLamports:'5000',
  absentAtaCount:2,maxAtaRentPerAccountLamports:'5852160',
  walletBalanceLamports:'0',extraCpiDebitUpperBoundLamports:null,
  manualSellExitReserveLamports:null,pendingReservedDebitsLamports:null,
  solUsdCents:null,fullPumpCpiAndRentAudited:false,
  manualSellSimulationVerified:false,...changes};
}
test('real mainnet unfunded 0.025 SOL diagnostic is only a provisional attempt floor',()=>{
 const d=assessPumpFundingReadiness(diagnostic());
 assert.deepEqual(d,{
  mode:'UNSIGNED_DIAGNOSTIC_ONLY',canFund:false,canSign:false,canBroadcast:false,
  provisionalUnsignedAttemptFloorLamports:'36709320',
  provisionalShortfallLamports:'36709320',
  fullyVerifiedFundingRequirementLamports:null,
  maxFiveDollarBuyDebitLamports:null,
  reason:'CPI_AND_MANUAL_SELL_RESERVE_NOT_FULLY_VERIFIED'
 });
 assert.equal(ECHO_FUNDING_READINESS_AUTHORISES_FUNDING,false);
});
test('even with provisional SOL in wallet, unknown CPI/SELL costs never authorize funding',()=>{
 const d=assessPumpFundingReadiness(diagnostic({walletBalanceLamports:'40000000'}));
 assert.equal(d.provisionalShortfallLamports,'0');
 assert.equal(d.fullyVerifiedFundingRequirementLamports,null);
 assert.equal(d.canFund,false);
});
test('known synthetic fees can yield a diagnostic total, still never sign or fund',()=>{
 const d=assessPumpFundingReadiness(diagnostic({
  principalLamports:'10000000',absentAtaCount:1,
  extraCpiDebitUpperBoundLamports:'200000',
  manualSellExitReserveLamports:'1000000',
  pendingReservedDebitsLamports:'1000000',solUsdCents:'20000',
  fullPumpCpiAndRentAudited:true,manualSellSimulationVerified:true
 }));
 assert.equal(d.fullyVerifiedFundingRequirementLamports,'18057160');
 assert.equal(d.maxFiveDollarBuyDebitLamports,'25000000');
 assert.equal(d.reason,'FUNDED_STATE_SIMULATION_AND_OWNER_APPROVAL_STILL_REQUIRED');
 assert.equal(d.canSign,false);
});
test('missing independent amounts and any above-$5 debit fail closed',()=>{
 const missing=assessPumpFundingReadiness(diagnostic({
  fullPumpCpiAndRentAudited:true,manualSellSimulationVerified:true
 }));
 assert.equal(missing.reason,'UNKNOWN_EXTRA_CPI_SELL_RESERVE_PENDING_OR_FX');
 const over=assessPumpFundingReadiness(diagnostic({
  extraCpiDebitUpperBoundLamports:'1000000',manualSellExitReserveLamports:'2000000',
  pendingReservedDebitsLamports:'0',solUsdCents:'20000',
  fullPumpCpiAndRentAudited:true,manualSellSimulationVerified:true
 }));
 assert.equal(over.reason,'ALL_IN_ENTRY_WOULD_EXCEED_FIVE_DOLLARS');
 assert.equal(over.canFund,false);
});
