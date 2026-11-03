import test from 'node:test';
import assert from 'node:assert/strict';
import {replayBoostStrategyC,BOOST_STRATEGY_C_LIVE_TRADING_ENABLED}
 from '../src/echo/boostStrategyCPaper.js';
const points=(prices:number[])=>prices.map((priceUsd,i)=>({
 at:1800000000+i*60,priceUsd,liquidityUsd:25_000,pool:'same-pool'
}));
const approximate=(a:number,b:number)=>assert.ok(Math.abs(a-b)<0.00001,`expected ${a} ~ ${b}`);
test('15% initial stop exits at next observed price, not an optimistic stop quote',()=>{
 const r=replayBoostStrategyC(points([1,0.7]));
 assert.equal(r.status,'CLOSED');
 assert.equal(r.exits.length,1);
 assert.equal(r.exits[0].kind,'INITIAL_STOP');
 assert.equal(r.exits[0].priceUsd,0.7);
 approximate(r.estimatedRealizedPnlUsd,-3.1393);
 assert.equal(r.executableVerified,false);
 assert.equal(BOOST_STRATEGY_C_LIVE_TRADING_ENABLED,false);
});
test('30% move protects estimated after-cost breakeven but may gap below',()=>{
 const r=replayBoostStrategyC(points([1,1.32,1.05,1.02]));
 assert.equal(r.exits[0].kind,'INITIAL_STOP');
 assert.equal(r.exits[0].priceUsd,1.02);
 assert.ok(r.estimatedRealizedPnlUsd<0);
});
test('at +50% sells 75% once, trails runner, tracks costs on each sale',()=>{
 const r=replayBoostStrategyC(points([1,1.5,1.75,1.28]));
 assert.equal(r.status,'CLOSED');
 assert.deepEqual(r.exits.map(x=>x.kind),['PARTIAL_75','RUNNER_STOP']);
 approximate(r.exits[0].fractionOfInitial,0.75);
 approximate(r.exits[1].fractionOfInitial,0.25);
 approximate(r.realizedPaperProceedsUsd,
  10*0.99*0.75*1.5*0.99+10*0.99*0.25*1.28*0.99);
 assert.ok(r.estimatedRealizedPnlUsd>0);
});
test('100x mark after runner stopped is not counted as owned paper profit',()=>{
 const r=replayBoostStrategyC(points([1,1.5,1.1,100]));
 assert.equal(r.status,'CLOSED');
 assert.equal(r.exits.at(-1)?.priceUsd,1.1);
 assert.equal(r.exits.length,2);
 approximate(r.markToMarketPnlUsd!,r.estimatedRealizedPnlUsd);
 assert.ok(r.estimatedRealizedPnlUsd<2);
});
test('trailing thresholds tighten after 2x and 5x; no lookahead',()=>{
 const two=replayBoostStrategyC(points([1,1.5,2,1.59]));
 assert.deepEqual(two.exits.map(x=>x.kind),['PARTIAL_75','RUNNER_STOP']);
 const five=replayBoostStrategyC(points([1,1.5,5,4.2]));
 assert.deepEqual(five.exits.map(x=>x.kind),['PARTIAL_75','RUNNER_STOP']);
});
test('runner remains open rather than faking a realized sale at last mark',()=>{
 const r=replayBoostStrategyC(points([1,1.6,2.5]));
 assert.equal(r.status,'RUNNER_OPEN');
 assert.equal(r.exits.length,1);
 approximate(r.remainingFraction,0.25);
 assert.ok(r.markToMarketPnlUsd!>r.estimatedRealizedPnlUsd);
});
test('no partial sale before threshold, no same-tick entry exit',()=>{
 assert.equal(replayBoostStrategyC(points([1])).status,'FULL_OPEN');
 const r=replayBoostStrategyC(points([1,1.49]));
 assert.equal(r.exits.length,0);
});
test('reject stale ordering, pool switch, bad marks, invalid stake',()=>{
 for(const prices of [[1,0],[1,-1],[1,NaN],[1,Infinity]]){
  assert.equal(replayBoostStrategyC(points(prices)).status,'INVALID_OBSERVATIONS');
 }
 const unordered=points([1,2]);unordered[1].at=unordered[0].at;
 assert.equal(replayBoostStrategyC(unordered).status,'INVALID_OBSERVATIONS');
 const different=points([1,2]);different[1].pool='different';
 assert.equal(replayBoostStrategyC(different).status,'INVALID_OBSERVATIONS');
 assert.equal(replayBoostStrategyC(points([1,2]),{stakeUsd:100}).status,'INVALID_OBSERVATIONS');
});
test('paper-only state does not spend, sign, auto-close or imply real fill',()=>{
 const r=replayBoostStrategyC(points([1,1.6]));
 assert.equal(r.paperOnly,true);
 assert.equal(r.executableVerified,false);
 assert.equal(BOOST_STRATEGY_C_LIVE_TRADING_ENABLED,false);
});
