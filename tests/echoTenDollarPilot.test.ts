import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIRMAN_WALLET, SLINGOOR_WALLET } from '../src/echo/liveBuyPolicy.js';
import {screenEchoTenDollarPilot} from '../src/echo/tenDollarPilot.js';
const mint='So11111111111111111111111111111111111111112';
const now=1800000000000;
const good={callerWallet:SLINGOOR_WALLET,mint,verifiedBuyerSigner:true,
 originalSwapSucceeded:true,verifiedSpend:true,verifiedTokenCredit:true,
 priceSolUsd:200,priceObservedAtMs:now,nowMs:now,spentOrdersToday:0,
 alreadyReservedOrPurchased:false,killSwitchEngaged:false,maxFeeLamports:500000};
test('$10 pilot calculates SOL equivalent within 0.1 SOL',()=>{
 const result=screenEchoTenDollarPilot(good);
 assert.deepEqual(result,{allowed:true,amountLamports:50000000,principalUsd:10});
 assert.equal(screenEchoTenDollarPilot({...good,callerWallet:CHAIRMAN_WALLET}).allowed,true);
});
test('two-caller pilot fails closed on gifts, repeat buys and kill switch',()=>{
 for(const bad of [
  {callerWallet:'1'.repeat(44)}, {verifiedBuyerSigner:false},
  {originalSwapSucceeded:false},{verifiedSpend:false},{verifiedTokenCredit:false},
  {alreadyReservedOrPurchased:true},{killSwitchEngaged:true},{spentOrdersToday:3},
  {priceObservedAtMs:now-3001},{priceSolUsd:0},{priceSolUsd:50},
  {maxFeeLamports:1_000_001},{mint:'not-a-mint'}
 ]) assert.equal(screenEchoTenDollarPilot({...good,...bad}).allowed,false);
});
