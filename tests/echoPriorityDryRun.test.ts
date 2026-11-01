import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateEchoPriorityDryRun} from '../src/echo/priorityDryRun.js';
const now=1793542438000;
const trade={
 signal:{callerWallet:'5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',
 mint:'GczSofuFAmwZkTXBaw9kpeo36Sven8q9fXDXmvUSpump',
 amountSol:0.1,side:'BUY' as const,isVerifiedSwap:true,
 transactionSignature:'5qUsc7brjYRpmHLJbQcJMwBuB6PxuNmMwtZ1rCL7owz98sBs4FPEsT5p8RNqhbHFh4egvok4NPs1bncdTa4WeuP5'},
 executionWallet:'8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ',
 callerTradeAtMs:now,observedAtMs:now+1200,
 verificationFinishedAtMs:now+1422,hypotheticalQuoteBuildMs:350,
 hypotheticalSimulationMs:250,simulationWouldPass:true,
 callerEntryPriceSolPerToken:0.000001,currentQuotePriceSolPerToken:0.00000102,
 quoteValid:true,accountsFullyResolved:true,sellRouteVerified:true,
 slippageBps:300,purchasedOrReservedMint:false,openOrPendingPositions:1,
 realizedLossSolToday:0.01,killSwitch:false
};
const fee={samples:Array.from({length:20},(_,i)=>({slot:467000000+i,prioritizationFee:i*1000})),
 writableAccounts:['8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ'],
 simulationUnitsConsumed:200000};
test('within policy and fee cap is research candidate, never executable',()=>{
 const p=evaluateEchoPriorityDryRun({trade,fee});
 assert.equal(p.candidate,true);
 assert.equal(p.executable,false);assert.equal(p.broadcast,false);
 assert.equal(p.guaranteedLanding,false);
 assert.equal(p.reason,'SHADOW_CANDIDATE_ONLY');
});
test('unaffordable localized fee rejects rather than outbids indefinitely',()=>{
 const result=evaluateEchoPriorityDryRun({trade,fee:{...fee,
 samples:fee.samples.map(x=>({...x,prioritizationFee:4_000_000}))}});
 assert.equal(result.candidate,false);
 assert.equal(result.reason,'OBSERVED_LANDING_FEE_EXCEEDS_BUDGET_SKIP_TRADE');
});
test('risk gates cannot be overridden by a cheap fee quote',()=>{
 const result=evaluateEchoPriorityDryRun({trade:{...trade,killSwitch:true},fee});
 assert.equal(result.candidate,false);
 assert.equal(result.reason,'KILL_SWITCH');
});
