/**
 * Echo fast-follower price/latency gate (shadow only).
 *
 * Compare the caller's VERIFIED on-chain effective entry price against the
 * quote received for our $10-sized order. The quote is supplied by a trusted
 * server-side provider, never Telegram. Integer ratios prevent floating-point
 * price drift on very small-cap coins.
 *
 * This gate does not reserve positions or authorize a signature. The atomic
 * reservation and isolated signer must recheck quote age, balances, all fees,
 * instruction accounts and token destinations immediately before execution.
 */
export const ECHO_FAST_FOLLOWER_SIGNING_ENABLED=false as const;
export const ECHO_MAX_ENTRY_MARKUP_BPS=300;
export const ECHO_MAX_EXECUTION_SLIPPAGE_BPS=300;
export const ECHO_MAX_VERIFIED_BUY_AGE_MS=5000;
export const ECHO_MAX_QUOTE_AGE_MS=1200;

export type EchoFastFollowerCandidate={
 callerBuySignature:string;callerVerified:boolean;callerMint:string;quoteMint:string;callerBoughtAtMs:number;
 detectionAtMs:number;nowMs:number;quoteObservedAtMs:number;
 callerSpentLamports:string;callerTokensReceivedRaw:string;
 ourInputLamports:string;ourQuotedTokensOutRaw:string;
 quoteSlippageBps:number;alreadyReserved:boolean;
};
export type EchoFastFollowerResult=
 | {eligible:true;mode:'SHADOW_ONLY';callerBuyAgeMs:number;
     quoteAgeMs:number;priceMarkupBps:number;signingApproved:false}
 | {eligible:false;reason:string;signingApproved:false};
const reject=(reason:string):EchoFastFollowerResult=>({eligible:false,reason,signingApproved:false});
const positive=(v:string)=>typeof v==='string'&&/^[1-9][0-9]*$/.test(v)&&v.length<=32;
export function screenEchoFastFollower(c:EchoFastFollowerCandidate):EchoFastFollowerResult{
 if(!c.callerVerified||!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(c.callerBuySignature))
  return reject('UNVERIFIED_CALLER_SWAP');
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(c.callerMint)||
    c.callerMint!==c.quoteMint)return reject('MINT_MISMATCH');
 if(c.alreadyReserved)return reject('DUPLICATE_TOKEN');
 if(!Number.isSafeInteger(c.nowMs)||!Number.isSafeInteger(c.callerBoughtAtMs)||
    !Number.isSafeInteger(c.detectionAtMs)||!Number.isSafeInteger(c.quoteObservedAtMs)||
    c.callerBoughtAtMs>c.detectionAtMs||
    c.detectionAtMs>c.nowMs||c.quoteObservedAtMs>c.nowMs)
  return reject('INVALID_CLOCK_EVIDENCE');
 const callerBuyAgeMs=c.nowMs-c.callerBoughtAtMs;
 if(callerBuyAgeMs>ECHO_MAX_VERIFIED_BUY_AGE_MS)return reject('CALLER_BUY_TOO_OLD');
 const quoteAgeMs=c.nowMs-c.quoteObservedAtMs;
 if(quoteAgeMs>ECHO_MAX_QUOTE_AGE_MS)return reject('STALE_ENTRY_QUOTE');
 if(!Number.isSafeInteger(c.quoteSlippageBps)||c.quoteSlippageBps<0||
    c.quoteSlippageBps>ECHO_MAX_EXECUTION_SLIPPAGE_BPS)
  return reject('EXCESSIVE_QUOTE_SLIPPAGE');
 if(![c.callerSpentLamports,c.callerTokensReceivedRaw,c.ourInputLamports,
      c.ourQuotedTokensOutRaw].every(positive))
  return reject('UNVERIFIED_PRICE_QUANTITIES');
 const spent=BigInt(c.callerSpentLamports);
 const got=BigInt(c.callerTokensReceivedRaw);
 const ourSpent=BigInt(c.ourInputLamports);
 const ourGot=BigInt(c.ourQuotedTokensOutRaw);
 if(ourSpent>100_000_000n)return reject('EXCEEDS_0_1_SOL_CAP');
 // (ours / quotedOut) / (callerSpent / callerOut), in integer basis points.
 const priceMarkupBps=Number((ourSpent*got*10_000n)/(spent*ourGot)-10_000n);
 if(!Number.isSafeInteger(priceMarkupBps))return reject('PRICE_RATIO_OVERFLOW');
 if(priceMarkupBps>ECHO_MAX_ENTRY_MARKUP_BPS)return reject('PRICE_ALREADY_RAN');
 return {eligible:true,mode:'SHADOW_ONLY',callerBuyAgeMs,quoteAgeMs,
  priceMarkupBps,signingApproved:false};
}
