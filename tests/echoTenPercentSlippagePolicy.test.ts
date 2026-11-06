import test from 'node:test';
import assert from 'node:assert/strict';
import {screenEchoAutoBuyShadow,ECHO_AUTO_BUY_MAX_SLIPPAGE_BPS,
 ECHO_AUTO_BUY_MAX_PRICE_PREMIUM_BPS} from '../src/echo/autoBuyShadowGate.js';
import {SLINGOOR_WALLET} from '../src/echo/liveBuyPolicy.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const now=1800000000000;
const input={
 signal:{callerWallet:SLINGOOR_WALLET,
  mint:'So11111111111111111111111111111111111111113',
  amountSol:0.05,side:'BUY' as const,isVerifiedSwap:true,
  transactionSignature:'3'.repeat(64)},
 executionWallet:wallet,nowMs:now,callerTradeAtMs:now-200,
 verifiedAtMs:now-150,quoteAtMs:now-100,
 callerEntryPriceSolPerToken:0.1,currentQuotePriceSolPerToken:0.1,
 quoteValid:true,unsignedSimulationPassed:true,accountsFullyResolved:true,
 sellRouteVerified:true,slippageBps:1000,purchasedOrReservedMint:false,
 openOrPendingPositions:0,realizedLossSolToday:0,killSwitch:false
};
test('new user trading policy: 1000 bps slippage and 5000 bps premium',()=>{
 assert.equal(ECHO_AUTO_BUY_MAX_SLIPPAGE_BPS,1000);
 assert.equal(ECHO_AUTO_BUY_MAX_PRICE_PREMIUM_BPS,5000);
 assert.equal(screenEchoAutoBuyShadow(input).candidate,true);
 assert.equal(screenEchoAutoBuyShadow({...input,slippageBps:1001}).reason,'SLIPPAGE_CAP');
 assert.equal(screenEchoAutoBuyShadow({...input,
  currentQuotePriceSolPerToken:0.149}).candidate,true);
 assert.equal(screenEchoAutoBuyShadow({...input,
  currentQuotePriceSolPerToken:0.151}).reason,'PRICE_ALREADY_INFLATED');
});
test('changing slippage does not authorize spending or bypass slots/duplicates',()=>{
 const r=screenEchoAutoBuyShadow(input);
 assert.equal(r.executable,false);
 assert.equal(screenEchoAutoBuyShadow({...input,purchasedOrReservedMint:true}).reason,'DUPLICATE_MINT');
 assert.equal(screenEchoAutoBuyShadow({...input,openOrPendingPositions:2}).reason,'POSITION_LIMIT');
});
