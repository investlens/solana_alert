import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPaperExecution,paperEstimateAuthorizesTrading} from '../src/echo/paperExecutionAssessment.js';
import {validateBuyAdmission,SLINGOOR_WALLET,CHAIRMAN_WALLET,LIVE_EXECUTION_ENABLED,AUTO_SELL_ENABLED} from '../src/echo/liveBuyPolicy.js';
import {adminBuyToken,adminSellTokenPercent,ONCHAIN_ADMIN_TRADING_PERMANENTLY_DISABLED} from '../src/core/adminTrading.js';
const mint='BSe1q3SL6KQPLeZHFG9nNw5VFbDL3ZXvBmtjBVpYpump';
const sig='3tsw3jLK5fDZoeUZkHmLmRbPrUtxu3M4AymDV8638MgEgkjKq4KX4vfaDc8rquzcBXTqKDQS1RoiCofXojdnxKK1';
test('paper: no price, missing liquidity and illiquid pools never show simulated P/L',()=>{
 for(const v of [{entryUsd:null,liquidityUsd:5000},{entryUsd:.000001,liquidityUsd:null},{entryUsd:.01,liquidityUsd:500}]){
  const x=assessPaperExecution(v);
  assert.notEqual(x.status,'ESTIMATE_ONLY');
  assert.equal(x.hypotheticalNetPnlUsd,null);
  assert.equal(paperEstimateAuthorizesTrading(x),false);
 }
});
test('paper: stake fixed at $10, costs both sides, no fabricated executable quote',()=>{
 const x=assessPaperExecution({entryUsd:.001,exitUsd:.0015,liquidityUsd:5000});
 assert.equal(x.status,'ESTIMATE_ONLY');
 assert.equal(x.stakeUsd,10);
 assert.equal(x.executableVerified,false);
 assert.equal(x.assumedFeesBpsPerSide,100);
 assert.equal(x.assumedSlippageBpsPerSide,40);
 assert.ok(x.hypotheticalNetPnlUsd!==null);
 assert.ok(x.hypotheticalNetPnlUsd! < 5);
 assert.equal(paperEstimateAuthorizesTrading(x),false);
});
test('paper: missing exit price cannot produce final sale or P/L',()=>{
 const x=assessPaperExecution({entryUsd:.001,liquidityUsd:5000});
 assert.equal(x.hypotheticalExitUsd,null);
 assert.equal(x.hypotheticalNetPnlUsd,null);
});
test('manual guard: two allowed caller IDs, rejects invalid sides, sizes and unverified signals',()=>{
 const e={callerWallet:SLINGOOR_WALLET,mint,amountSol:0.05,side:'BUY' as const,
   isVerifiedSwap:true,transactionSignature:sig};
 assert.deepEqual(validateBuyAdmission(e,CHAIRMAN_WALLET),{allowed:true,key:CHAIRMAN_WALLET+':'+mint});
 for(const bad of [
   {...e,amountSol:0.101},{...e,amountSol:-.1},{...e,side:'SELL' as const},
   {...e,isVerifiedSwap:false},{...e,callerWallet:mint},{...e,mint:'bad'}
 ])assert.equal(validateBuyAdmission(bad,CHAIRMAN_WALLET).allowed,false);
});
test('manual trade submission and auto-sell remain code-level disabled',async()=>{
 assert.equal(LIVE_EXECUTION_ENABLED,false);
 assert.equal(AUTO_SELL_ENABLED,false);
 assert.equal(ONCHAIN_ADMIN_TRADING_PERMANENTLY_DISABLED,true);
 await assert.rejects(adminBuyToken({outputMint:mint,amountSol:.05}),/disabled/);
 await assert.rejects(adminSellTokenPercent({inputMint:mint,percent:100}),/disabled/);
});
