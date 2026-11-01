import test from 'node:test';
import assert from 'node:assert/strict';
import {replayEchoAutoBuyDryRun} from '../src/echo/autoBuyDryRunBudget.js';
const tradeAt=1793542438000;
const good={
 signal:{
  callerWallet:'5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',
  mint:'GczSofuFAmwZkTXBaw9kpeo36Sven8q9fXDXmvUSpump',
  amountSol:0.1,side:'BUY' as const,isVerifiedSwap:true,
  transactionSignature:'5qUsc7brjYRpmHLJbQcJMwBuB6PxuNmMwtZ1rCL7owz98sBs4FPEsT5p8RNqhbHFh4egvok4NPs1bncdTa4WeuP5'
 },
 executionWallet:'8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ',
 callerTradeAtMs:tradeAt,observedAtMs:tradeAt+1200,
 verificationFinishedAtMs:tradeAt+1422,
 hypotheticalQuoteBuildMs:350,hypotheticalSimulationMs:250,
 simulationWouldPass:true,
 callerEntryPriceSolPerToken:0.000001,
 currentQuotePriceSolPerToken:0.00000102,
 quoteValid:true,accountsFullyResolved:true,sellRouteVerified:true,
 slippageBps:300,purchasedOrReservedMint:false,
 openOrPendingPositions:1,realizedLossSolToday:0.01,killSwitch:false
};
test('historical Telegram timing + hypothetical fast quote/trace remains shadow only',()=>{
 const result=replayEchoAutoBuyDryRun(good);
 assert.equal(result.hypotheticalEndToEndMs,2022);
 assert.equal(result.budgetRemainingMs,978);
 assert.equal(result.verdict.candidate,true);
 assert.equal(result.verdict.executable,false);
 assert.equal(result.signed,false);assert.equal(result.broadcast,false);
 assert.equal(result.assumptions,'HYPOTHETICAL_READ_ONLY');
});
test('slow quote construction rejects same signal; no optimistic trade approval',()=>{
 const result=replayEchoAutoBuyDryRun({...good,hypotheticalQuoteBuildMs:1500});
 assert.equal(result.verdict.candidate,false);
 assert.equal(result.verdict.reason,'STALE_OR_UNVERIFIED_SIGNAL');
 assert.equal(result.broadcast,false);
});
test('simulation, security, duplicate and price protection still fail closed',()=>{
 const result=replayEchoAutoBuyDryRun({...good,simulationWouldPass:false});
 assert.equal(result.verdict.reason,'ROUTE_OR_SIMULATION_UNVERIFIED');
 const duplicate=replayEchoAutoBuyDryRun({...good,purchasedOrReservedMint:true});
 assert.equal(duplicate.verdict.reason,'DUPLICATE_MINT');
 const inflated=replayEchoAutoBuyDryRun({...good,currentQuotePriceSolPerToken:0.00000105});
 assert.equal(inflated.verdict.reason,'PRICE_ALREADY_INFLATED');
});
test('impossible or clock-reversed timing is rejected',()=>{
 assert.throws(()=>replayEchoAutoBuyDryRun({...good,observedAtMs:tradeAt-10}),/INVALID_LATENCY_EVIDENCE/);
 assert.throws(()=>replayEchoAutoBuyDryRun({...good,hypotheticalSimulationMs:-1}),/INVALID_LATENCY_EVIDENCE/);
});
