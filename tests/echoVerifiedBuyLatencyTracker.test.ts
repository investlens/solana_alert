import test from 'node:test';
import assert from 'node:assert/strict';
import {EchoVerifiedBuyLatencyTracker,ECHO_SHADOW_LATENCY_EXECUTION_ENABLED}
 from '../src/echo/verifiedBuyLatencyTracker.js';
import {SLINGOOR_WALLET,CHAIRMAN_WALLET} from '../src/echo/liveBuyPolicy.js';
const sig='3'.repeat(64),sig2='4'.repeat(64),ms=1762000000000;
test('actual verified Slingoor websocket handoff yields bounded real timestamps only',()=>{
 let clock=ms+150;
 const t=new EchoVerifiedBuyLatencyTracker(()=>clock);
 t.websocketObserved(sig,SLINGOOR_WALLET);
 t.verifiedBuy({signature:sig,wallet:SLINGOOR_WALLET,
  chainTimestampSec:ms/1000,fetchStartedAtMs:ms+200,verifiedAtMs:ms+430});
 const x=t.summary();
 const s=x.callers[0];
 assert.equal(x.mode,'SHADOW_OBSERVE_ONLY');
 assert.equal(ECHO_SHADOW_LATENCY_EXECUTION_ENABLED,false);
 assert.equal(s.caller,'Slingoor');
 assert.equal(s.websocketVerifiedBuys,1);
 assert.equal(s.queueWait.p50Ms,50);
 assert.equal(s.verification.p50Ms,230);
 assert.equal(s.chainToDetection.p50Ms,150);
 assert.equal(s.chainToVerification.p50Ms,430);
 assert.equal(s.quoteMs,null);
 assert.equal(x.quoteStage,'NOT_CONNECTED');
 assert.equal(JSON.stringify(x).includes(sig),false);
 assert.equal(JSON.stringify(x).includes(SLINGOOR_WALLET),false);
});
test('Chairman reconciliation is not misrepresented as websocket latency',()=>{
 const t=new EchoVerifiedBuyLatencyTracker(()=>ms);
 t.verifiedBuy({signature:sig2,wallet:CHAIRMAN_WALLET,
  chainTimestampSec:ms/1000,fetchStartedAtMs:ms+2000,verifiedAtMs:ms+2500});
 const c=t.summary().callers[1];
 assert.equal(c.verifiedBuyEvents,1);
 assert.equal(c.reconciliationVerifiedBuys,1);
 assert.equal(c.websocketVerifiedBuys,0);
 assert.equal(c.chainToDetection.count,0);
 assert.equal(c.quoteMs,null);
});
test('duplicate websocket observations preserve first timestamp and wallet binding',()=>{
 let clock=ms+100;
 const t=new EchoVerifiedBuyLatencyTracker(()=>clock);
 t.websocketObserved(sig,SLINGOOR_WALLET);
 clock=ms+600;
 t.websocketObserved(sig,SLINGOOR_WALLET);
 t.websocketObserved(sig,CHAIRMAN_WALLET);
 t.verifiedBuy({signature:sig,wallet:SLINGOOR_WALLET,
  chainTimestampSec:ms/1000,fetchStartedAtMs:ms+700,verifiedAtMs:ms+850});
 assert.equal(t.summary().callers[0].chainToDetection.p50Ms,100);
 t.verifiedBuy({signature:sig,wallet:CHAIRMAN_WALLET,
  chainTimestampSec:ms/1000,fetchStartedAtMs:ms+750,verifiedAtMs:ms+900});
 assert.equal(t.summary().callers[1].chainToDetection.p50Ms,600);
});
test('unknown wallet, malformed signature and invalid timing are rejected',()=>{
 const t=new EchoVerifiedBuyLatencyTracker(()=>ms);
 t.websocketObserved('invalid',SLINGOOR_WALLET);
 t.websocketObserved(sig,'5'.repeat(44));
 t.verifiedBuy({signature:sig,wallet:SLINGOOR_WALLET,
  chainTimestampSec:ms/1000,fetchStartedAtMs:ms+1000,verifiedAtMs:ms+900});
 assert.equal(t.summary().rejectedClock,1);
 assert.equal(t.summary().sampleCount,0);
});

test('Telegram retries never inflate verified swap latency samples',()=>{
 const t=new EchoVerifiedBuyLatencyTracker(()=>ms+100);
 t.websocketObserved(sig,SLINGOOR_WALLET);
 const e={signature:sig,wallet:SLINGOOR_WALLET,
  chainTimestampSec:ms/1000,fetchStartedAtMs:ms+200,verifiedAtMs:ms+400};
 t.verifiedBuy(e);
 t.verifiedBuy({...e,fetchStartedAtMs:ms+700,verifiedAtMs:ms+900});
 assert.equal(t.summary().sampleCount,1);
 assert.equal(t.summary().callers[0].websocketVerifiedBuys,1);
 assert.equal(t.summary().callers[0].reconciliationVerifiedBuys,0);
});
