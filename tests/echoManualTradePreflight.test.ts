import test from 'node:test';import assert from 'node:assert/strict';
import {reviewManualBuyPreview,reviewManualSellPreview,type ManualPreview} from '../src/echo/manualTradePreflight.js';
import {SLINGOOR_WALLET} from '../src/echo/liveBuyPolicy.js';
const preview:ManualPreview={
 ownerChatId:'123',requestChatId:'123',ownerWallet:'Be24Gbf5KisDk1LcWWZsBn8dvB816By7YzYF5zWZnRR6',
 trade:{callerWallet:SLINGOOR_WALLET,mint:'BSe1q3SL6KQPLeZHFG9nNw5VFbDL3ZXvBmtjBVpYpump',amountSol:0.05,side:'BUY',isVerifiedSwap:true,transactionSignature:'3tsw3jLK5fDZoeUZkHmLmRbPrUtxu3M4AymDV8638MgEgkjKq4KX4vfaDc8rquzcBXTqKDQS1RoiCofXojdnxKK1'},
 quoteMint:'BSe1q3SL6KQPLeZHFG9nNw5VFbDL3ZXvBmtjBVpYpump',quoteAtMs:1000,quoteExpiresAtMs:6000,
 simulationOk:true,walletBalanceSol:0.10,networkReserveSol:0.01,alreadyPurchasedToken:false,reservationState:'AVAILABLE'
};
test('manual buy preview is hard-off, never returns executable true',()=>{
 assert.deepEqual(reviewManualBuyPreview(preview,2000),{eligible:false,reason:'LIVE_EXECUTION_DISABLED',executionEnabled:false});
});
test('manual buy denies wrong admin, stale/mismatched quote, unverified simulation and reused token',()=>{
 const checks:[[Partial<ManualPreview>,number,string],...Array<[Partial<ManualPreview>,number,string]>]=[
  [{requestChatId:'456'},2000,'NOT_ADMIN'],
  [{quoteMint:'bad'},2000,'QUOTE_MINT_MISMATCH'],
  [{quoteExpiresAtMs:2000},2000,'STALE_QUOTE'],
  [{simulationOk:false},2000,'SIMULATION_NOT_VERIFIED'],
  [{alreadyPurchasedToken:true},2000,'TOKEN_ALREADY_RESERVED_OR_UNKNOWN'],
  [{reservationState:'UNKNOWN'},2000,'TOKEN_ALREADY_RESERVED_OR_UNKNOWN'],
  [{reservationState:'RESERVED'},2000,'TOKEN_ALREADY_RESERVED_OR_UNKNOWN'],
  [{walletBalanceSol:.051},2000,'INSUFFICIENT_SPENDABLE_BALANCE'],
  [{trade:{...preview.trade,amountSol:0.11}},2000,'AMOUNT_OUT_OF_RANGE']
 ];
 for(const [patch,now,reason] of checks)assert.equal(reviewManualBuyPreview({...preview,...patch},now).reason,reason);
});
test('manual sell requires owner and rejects automatic sell even with valid balance and simulation',()=>{
 const sell={ownerChatId:'123',requestChatId:'123',percent:100 as const,balanceVerified:true,simulated:true,automatic:false};
 assert.equal(reviewManualSellPreview(sell).reason,'LIVE_EXECUTION_DISABLED');
 assert.equal(reviewManualSellPreview({...sell,automatic:true}).reason,'AUTO_SELL_FORBIDDEN');
 assert.equal(reviewManualSellPreview({...sell,requestChatId:'999'}).reason,'NOT_ADMIN');
});
