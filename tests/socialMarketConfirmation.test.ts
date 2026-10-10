import test from 'node:test';
import assert from 'node:assert/strict';
import {createSocialIdentityTracker, confirmSocialMarket, socialMarketObservedAt} from '../src/chains/robinhood/socialMarketConfirmation.js';
import type {AlertKeyStats} from '../src/ui/alertKeyStats.js';

const start=Date.UTC(2026,9,10,12);
const stats=(at:number,extra:AlertKeyStats={}):AlertKeyStats=>({price:1,curveReserve:800,
  preBond:true,checkedAt:new Date(at).toISOString().slice(11,19),...extra});
test('social confirmation requires two fresh spaced observations of the same venue and identity',()=>{
  const first=confirmSocialMarket(stats(start),undefined,'project',start);
  assert.equal(first.ready,false);
  const previous=first.observation!;
  assert.equal(confirmSocialMarket(stats(start+60_000),previous,'project',start+60_000).ready,false);
  assert.equal(confirmSocialMarket(stats(start+121_000),previous,'project',start+121_000).ready,true);
  assert.equal(confirmSocialMarket(stats(start+121_000),previous,'other',start+121_000).ready,false);
  assert.equal(confirmSocialMarket(stats(start+301_000),previous,'project',start+301_000).ready,false);
  for(const extra of [{price:0.9},{curveReserve:799}]) {
    const falling=confirmSocialMarket(stats(start+121_000,extra),previous,'project',start+121_000);
    assert.equal(falling.reason,'PRICE_OR_DEPTH_DECLINED');
    assert.equal(falling.observation,undefined);
  }
});
test('cached, missing and future source data cannot confirm a social alert',()=>{
  const previous=confirmSocialMarket(stats(start),undefined,'project',start).observation;
  for(const checkedAt of [undefined,'99:00:00','12:00:00','12:05:00'])
    assert.equal(confirmSocialMarket(stats(start,{checkedAt}),previous,'project',start+121_000).ready,false);
  const dex=stats(start,{preBond:false,liquidity:5000,chartUrl:'https://dexscreener.com/robinhood/pool'});
  for(const at of [undefined,NaN,start-90_001,start+1])
    assert.equal(confirmSocialMarket(dex,undefined,'project',start,at).observation,undefined);
});
test('graduation and changed DEX pairs start new confirmation; same fresh pair can confirm',()=>{
  const curve=confirmSocialMarket(stats(start),undefined,'project',start).observation;
  const dex=(at:number,url='https://dexscreener.com/robinhood/pool')=>stats(at,{preBond:false,liquidity:5000,chartUrl:url});
  const first=confirmSocialMarket(dex(start+121_000),curve,'project',start+121_000,start+121_000);
  assert.equal(first.ready,false);
  const later=start+242_000;
  assert.equal(confirmSocialMarket(dex(later),first.observation,'project',later,later).ready,true);
  assert.equal(confirmSocialMarket(dex(later,'https://dexscreener.com/robinhood/other'),first.observation,'project',later,later).ready,false);
});
test('UTC source freshness handles midnight without accepting future time',()=>{
  const midnight=Date.UTC(2026,9,11,0,0,20);
  assert.equal(socialMarketObservedAt({checkedAt:'23:59:50'},midnight),midnight-30_000);
  assert.equal(socialMarketObservedAt({checkedAt:'00:00:30'},midnight),null);
});

test('shared social identity warnings expire and token-specific registrations stay bounded',()=>{
  const tracker=createSocialIdentityTracker(2);
  assert.equal(tracker.observe('A','project',1000,0),false);
  assert.equal(tracker.observe('A','Project',1000,0),false);
  assert.equal(tracker.observe('B','PROJECT',1000,0),true);
  assert.equal(tracker.observe('C','other',1000,0),false);
  assert.equal(tracker.observe('A','project',2000,1001),false);
  tracker.clear();
  assert.equal(tracker.observe('B','project',2000,1001),false);
});
