import test from 'node:test';
import assert from 'node:assert/strict';
import {screenEchoAutoBuyShadow,ECHO_SHADOW_AUTO_BUY_EXECUTION_ENABLED} from '../src/echo/autoBuyShadowGate.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const caller='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const mint='BSe1q3SL6KQPLeZHFG9nNw5VFbDL3ZXvBmtjBVpYpump';
const now=1793468000000;
const good={
 signal:{callerWallet:caller,mint,amountSol:0.1,side:'BUY' as const,isVerifiedSwap:true,
 transactionSignature:'3tsw3jLK5fDZoeUZkHmLmRbPrUtxu3M4AymDV8638MgEgkjKq4KX4vfaDc8rquzcBXTqKDQS1RoiCofXojdnxKK1'},
 executionWallet:wallet,nowMs:now,verifiedAtMs:now-800,quoteAtMs:now-200,
 callerEntryPriceSolPerToken:0.000001,currentQuotePriceSolPerToken:0.00000102,
 quoteValid:true,unsignedSimulationPassed:true,accountsFullyResolved:true,
 sellRouteVerified:true,slippageBps:300,purchasedOrReservedMint:false,
 openOrPendingPositions:1,realizedLossSolToday:0.01,killSwitch:false
};
const reason=(change:Record<string,unknown>)=>screenEchoAutoBuyShadow({...good,...change}).reason;
test('eligible case is only shadow, never executable',()=>{
 assert.equal(ECHO_SHADOW_AUTO_BUY_EXECUTION_ENABLED,false);
 assert.deepEqual(screenEchoAutoBuyShadow(good),{candidate:true,executable:false,reason:'SHADOW_ONLY',maxAmountSol:0.1});
});
test('late verification or quote and inflated entry are refused',()=>{
 assert.equal(reason({verifiedAtMs:now-3001}),'STALE_OR_UNVERIFIED_SIGNAL');
 assert.equal(reason({callerTradeAtMs:now-60000}),'STALE_OR_UNVERIFIED_SIGNAL');
 assert.equal(reason({quoteAtMs:now-2100}),'STALE_OR_UNVERIFIED_QUOTE');
 assert.equal(reason({currentQuotePriceSolPerToken:0.00000104}),'PRICE_ALREADY_INFLATED');
 assert.equal(reason({currentQuotePriceSolPerToken:NaN}),'PRICE_UNVERIFIED');
});
test('no duplicate, >2 open positions, daily loss >= 0.15 SOL, or slippage over 3%',()=>{
 assert.equal(reason({purchasedOrReservedMint:true}),'DUPLICATE_MINT');
 assert.equal(reason({openOrPendingPositions:2}),'POSITION_LIMIT');
 assert.equal(reason({realizedLossSolToday:0.15}),'DAILY_LOSS_BREAKER');
 assert.equal(reason({slippageBps:301}),'SLIPPAGE_CAP');
 assert.equal(reason({killSwitch:true}),'KILL_SWITCH');
});
test('no unsupported caller, unverified signer/swap, amount >0.1 or unresolved route',()=>{
 assert.equal(reason({signal:{...good.signal,callerWallet:wallet}}),'CALLER_NOT_ELIGIBLE');
 assert.equal(reason({signal:{...good.signal,isVerifiedSwap:false}}),'NOT_VERIFIED_BUY');
 assert.equal(reason({signal:{...good.signal,amountSol:0.101}}),'AMOUNT_OUT_OF_RANGE');
 assert.equal(reason({accountsFullyResolved:false}),'ROUTE_OR_SIMULATION_UNVERIFIED');
 assert.equal(reason({sellRouteVerified:false}),'ROUTE_OR_SIMULATION_UNVERIFIED');
 assert.equal(reason({unsignedSimulationPassed:false}),'ROUTE_OR_SIMULATION_UNVERIFIED');
});
