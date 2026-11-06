import test from 'node:test';
import assert from 'node:assert/strict';
import {screenEchoTwoHopQuote,ECHO_PUMP_TWO_HOP_TRADE_ENABLED}
 from '../src/echo/officialPumpTwoHopQuoteGate.js';
const base={
 wallet:'8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ',
 inputMint:'So11111111111111111111111111111111111111112',
 intermediateMint:'qhbbjGBKJxW3AZGqngWM5tHcrENR3pVoRB9MCf1pump',
 outputMint:'D4AnTZk3spQgCEMpC4iqtFp8U2qbiDvzrzdaq7Dopump',
 firstPool:'8zBr6K8wxVy8SmkEkYNtZWSpfwnQYWE7S1ATSMa7D1WY',
 secondPool:'JBsGNXRZQr9ZPc5PAn3seDE7At6ELq9LjVDCujgLKaq8',
 slippageBps:1000,quotedOutputRaw:'1000001',expectedOutputDecimals:6,
 inputLamports:'25000000',maxAdditionalLamports:'5000000',
 solUsdCentsPerSol:'20000',quoteObservedAtMs:1800000000100,
 nowMs:1800000000200,firstPoolVerified:true,secondPoolVerified:true,
 allFeeAccountsVerified:true,mintOwnersVerified:true,
 callerEntryPriceVerified:true,manualSellRouteVerified:true,
 fullWalletDebitVerified:true,realWalletSimulationPassed:true
};
test('verified fixture derives integer min-output with 10% slippage and full wallet ceiling',()=>{
 const r=screenEchoTwoHopQuote(base);
 assert.deepEqual(r,{ok:true,executable:false,reason:'PRICE_AND_FEE_PREFLIGHT_ONLY',
  amountLamports:'25000000',minOutputRaw:'900001',
  allInCents:'600',maxTotalWalletDebitLamports:'30000000'});
 assert.equal(ECHO_PUMP_TWO_HOP_TRADE_ENABLED,false);
});
test('never accept unknown economics or stale independent attestations',()=>{
 for(const patch of [
  {firstPoolVerified:false},{secondPoolVerified:false},
  {allFeeAccountsVerified:false},{mintOwnersVerified:false},
  {callerEntryPriceVerified:false},{manualSellRouteVerified:false},
  {fullWalletDebitVerified:false},{realWalletSimulationPassed:false},
  {quotedOutputRaw:'0'},{quotedOutputRaw:'abc'},{maxAdditionalLamports:'-5'},
  {inputLamports:'25000001'},{inputLamports:'100000000'},
  {slippageBps:1001},{slippageBps:0},{nowMs:1800000004000},
  {quoteObservedAtMs:1800000000500},{expectedOutputDecimals:18},
  {outputMint:base.intermediateMint},{firstPool:base.secondPool},
  {solUsdCentsPerSol:'0'},{maxAdditionalLamports:'10000001'},
  {solUsdCentsPerSol:'40000'}
 ]){
  const r=screenEchoTwoHopQuote({...base,...patch});
  assert.equal(r.ok,false,JSON.stringify(patch));
  assert.equal(r.executable,false);
 }
});
test('any accepted quote remains preview only, and arbitrary caller fields cannot unlock spending',()=>{
 const accepted=screenEchoTwoHopQuote({...base,slippageBps:200});
 assert.equal(accepted.ok,true);
 if(accepted.ok){assert.equal(accepted.minOutputRaw,'980001');assert.equal(accepted.executable,false);}
});

test('provisional fee bounds or unsigned failed simulations never count as authorized quote',()=>{
 const provisional=screenEchoTwoHopQuote({...base,fullWalletDebitVerified:false});
 assert.deepEqual(provisional,{ok:false,executable:false,reason:'FULL_WALLET_DEBIT_UNVERIFIED'});
 const failedSim=screenEchoTwoHopQuote({...base,realWalletSimulationPassed:false});
 assert.deepEqual(failedSim,{ok:false,executable:false,reason:'REAL_WALLET_SIMULATION_REQUIRED'});
 const missing=screenEchoTwoHopQuote({...base,fullWalletDebitVerified:undefined as unknown as boolean});
 assert.equal(missing.ok,false);
});
