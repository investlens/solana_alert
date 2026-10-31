/**
 * Echo fast-follower SHADOW timing evidence. Pure functions, no networking.
 * Records duration of verified caller handoff stages. Never logs wallets,
 * token addresses, signatures, API keys or raw transaction data.
 * Durations are useful for optimization but DO NOT authorize a trade.
 */
export type EchoLatencyStage='websocket'|'verification'|'quote'|'reservation'|'decision';
export type EchoShadowTiming={
 callerChainAtMs:number;websocketObservedAtMs:number;verifiedAtMs:number;
 quoteRequestedAtMs:number;quoteReceivedAtMs:number;
 reservationStartedAtMs:number;decisionAtMs:number;
};
export type EchoLatencyResult=
 |{ok:true;mode:'SHADOW_ONLY';chainToDetectionMs:number;verifyMs:number;
    quoteMs:number;reservationMs:number;endToEndMs:number;
    quoteWaitAfterVerificationMs:number;signingApproved:false}
 |{ok:false;reason:'INVALID_TIMING_EVIDENCE'|'STALE_CALLER'|'STALE_QUOTE';signingApproved:false};
const rejected=(reason:'INVALID_TIMING_EVIDENCE'|'STALE_CALLER'|'STALE_QUOTE'):EchoLatencyResult=>({ok:false,reason,signingApproved:false});
export function measureEchoShadowTiming(t:EchoShadowTiming):EchoLatencyResult{
 const values=[t.callerChainAtMs,t.websocketObservedAtMs,t.verifiedAtMs,
  t.quoteRequestedAtMs,t.quoteReceivedAtMs,t.reservationStartedAtMs,t.decisionAtMs];
 if(values.some(x=>!Number.isSafeInteger(x)||x<0)||
    t.callerChainAtMs>t.websocketObservedAtMs||
    t.websocketObservedAtMs>t.verifiedAtMs||
    t.quoteRequestedAtMs<t.websocketObservedAtMs||
    t.quoteReceivedAtMs<t.quoteRequestedAtMs||
    t.reservationStartedAtMs<t.verifiedAtMs||
    t.reservationStartedAtMs<t.quoteReceivedAtMs||
    t.decisionAtMs<t.reservationStartedAtMs)
  return rejected('INVALID_TIMING_EVIDENCE');
 const endToEndMs=t.decisionAtMs-t.callerChainAtMs;
 if(endToEndMs>5000)return rejected('STALE_CALLER');
 if(t.decisionAtMs-t.quoteReceivedAtMs>1200)return rejected('STALE_QUOTE');
 return {ok:true,mode:'SHADOW_ONLY',
  chainToDetectionMs:t.websocketObservedAtMs-t.callerChainAtMs,
  verifyMs:t.verifiedAtMs-t.websocketObservedAtMs,
  quoteMs:t.quoteReceivedAtMs-t.quoteRequestedAtMs,
  reservationMs:t.decisionAtMs-t.reservationStartedAtMs,
  endToEndMs,quoteWaitAfterVerificationMs:Math.max(0,t.quoteReceivedAtMs-t.verifiedAtMs),
  signingApproved:false};
}
export function summarizeEchoShadowLatencies(durations:number[]):{count:number;p50Ms:number|null;p95Ms:number|null;maxMs:number|null}{
 const valid=durations.filter(x=>Number.isSafeInteger(x)&&x>=0).slice(-500).sort((a,b)=>a-b);
 const pct=(percent:number)=>valid.length?valid[Math.ceil(valid.length*percent)-1]:null;
 return {count:valid.length,p50Ms:pct(.5),p95Ms:pct(.95),maxMs:valid.at(-1)??null};
}
