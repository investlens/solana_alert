import test from 'node:test';
import assert from 'node:assert/strict';
import {measureEchoShadowTiming,summarizeEchoShadowLatencies}
 from '../src/echo/fastFollowerLatencyEvidence.js';
const t={callerChainAtMs:10000,websocketObservedAtMs:10200,
 verifiedAtMs:10600,quoteRequestedAtMs:10210,quoteReceivedAtMs:10700,
 reservationStartedAtMs:10705,decisionAtMs:10730};
test('shadow timing computes wall-clock milestones without allowing signing',()=>{
 const result=measureEchoShadowTiming(t);
 assert.deepEqual(result,{ok:true,mode:'SHADOW_ONLY',chainToDetectionMs:200,
  verifyMs:400,quoteMs:490,reservationMs:25,endToEndMs:730,
  quoteWaitAfterVerificationMs:100,signingApproved:false});
});
test('reject impossible ordering, stale caller and stale quote',()=>{
 assert.deepEqual(measureEchoShadowTiming({...t,verifiedAtMs:10100}),
  {ok:false,reason:'INVALID_TIMING_EVIDENCE',signingApproved:false});
 assert.deepEqual(measureEchoShadowTiming({...t,decisionAtMs:16000}),
  {ok:false,reason:'STALE_CALLER',signingApproved:false});
 const stale={...t,callerChainAtMs:12000,websocketObservedAtMs:12200,
  verifiedAtMs:12300,quoteRequestedAtMs:12210,quoteReceivedAtMs:12300,
  reservationStartedAtMs:13500,decisionAtMs:13510};
 assert.deepEqual(measureEchoShadowTiming(stale),
  {ok:false,reason:'STALE_QUOTE',signingApproved:false});
});
test('bounded latency summaries show p50/p95 without recording identifiers',()=>{
 assert.deepEqual(summarizeEchoShadowLatencies([100,200,300,400,500,-1,NaN]),{
  count:5,p50Ms:300,p95Ms:500,maxMs:500});
 assert.deepEqual(summarizeEchoShadowLatencies([]),{
  count:0,p50Ms:null,p95Ms:null,maxMs:null});
});
