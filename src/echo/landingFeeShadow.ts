/** AlphaOS Echo read-only Solana v0 landing-fee planner.
 * No transactions, no signing, no RPC and no "highest bid" guarantee.
 * Priority fee data must be independently sourced from
 * getRecentPrioritizationFees for verified writable accounts.
 * CU limit is derived from actual simulation usage, never self-reported by a caller.
 */
export const ECHO_FEE_PLANNER_SHADOW_ONLY=true as const;
export const ECHO_DEFAULT_MAX_PRIORITY_AND_TIP_LAMPORTS=500_000n; // 0.0005 SOL, 0.5% of 0.1 SOL
export const ECHO_MIN_COMPUTE_UNITS=10_000;
export const ECHO_MAX_COMPUTE_UNITS=1_400_000;
const BASE_FEE_LAMPORTS=5_000n; // one signature; provisional until message verified
const MAX_SAMPLES=150;
export type EchoObservedPriorityFee={slot:number;prioritizationFee:number};
export type EchoLandingFeeInput={
 samples:readonly EchoObservedPriorityFee[];
 /** Accounts actually writable in the approved unsigned swap message. */
 writableAccounts:readonly string[];
 simulationUnitsConsumed:number;
 maxPriorityAndTipLamports?:bigint;
 /**
  * Only use tip quote in comparison mode. It must not be appended blindly
  * to a transaction; Jito route is NOT implemented.
  */
 proposedJitoTipLamports?:bigint;
};
export type EchoLandingFeePlan={
 mode:'SHADOW_ONLY';executable:false;guaranteedLanding:false;
 computeUnitLimit:number;microLamportsPerCu:number;
 estimatedPriorityLamports:string;estimatedBaseLamports:string;
 proposedTipLamports:string;totalEstimatedFeesLamports:string;
 maxAdditionalFeeLamports:string;feePercentOf0p1Sol:number;
 observedSamples:number;selectedPercentile:75;
 noBroadcastersConfigured:true;
};
export type EchoLandingFeeDecision=
 |{ok:true;plan:EchoLandingFeePlan}
 |{ok:false;reason:string;executable:false};
const MINT=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function ceilDiv(a:bigint,b:bigint){return(a+b-1n)/b;}
export function planEchoLandingFee(i:EchoLandingFeeInput):EchoLandingFeeDecision{
 const deny=(reason:string):EchoLandingFeeDecision=>({ok:false,reason,executable:false});
 const max=i.maxPriorityAndTipLamports??ECHO_DEFAULT_MAX_PRIORITY_AND_TIP_LAMPORTS;
 const tip=i.proposedJitoTipLamports??0n;
 if(typeof max!=='bigint'||max<0n||max>500_000n||
    typeof tip!=='bigint'||tip<0n||tip>max)
  return deny('INVALID_OR_UNBOUNDED_FEE_CAP');
 if(!Number.isSafeInteger(i.simulationUnitsConsumed)||i.simulationUnitsConsumed<ECHO_MIN_COMPUTE_UNITS||
    i.simulationUnitsConsumed>ECHO_MAX_COMPUTE_UNITS)
  return deny('INDEPENDENT_SIMULATION_REQUIRED');
 if(i.writableAccounts.length===0||i.writableAccounts.length>32||
    !i.writableAccounts.every(a=>MINT.test(a))||
    new Set(i.writableAccounts).size!==i.writableAccounts.length)
  return deny('VERIFIED_WRITABLE_ACCOUNTS_REQUIRED');
 if(i.samples.length<5||i.samples.length>MAX_SAMPLES||
    i.samples.some(s=>!Number.isSafeInteger(s.slot)||s.slot<1||
      !Number.isSafeInteger(s.prioritizationFee)||s.prioritizationFee<0||
      s.prioritizationFee>Number.MAX_SAFE_INTEGER))
  return deny('INVALID_OR_INSUFFICIENT_FEE_SAMPLES');
 // A 10% margin, rounded up, caps at the consensus transaction maximum.
 const units=Math.min(ECHO_MAX_COMPUTE_UNITS,
    Math.ceil(i.simulationUnitsConsumed*1.1));
 const prices=[...i.samples].map(s=>s.prioritizationFee).sort((a,b)=>a-b);
 const price=prices[Math.ceil(prices.length*.75)-1];
 const fee=ceilDiv(BigInt(price)*BigInt(units),1_000_000n);
 if(fee+tip>max)return deny('OBSERVED_LANDING_FEE_EXCEEDS_BUDGET_SKIP_TRADE');
 const total=fee+tip+BASE_FEE_LAMPORTS;
 return {ok:true,plan:{
   mode:'SHADOW_ONLY',executable:false,guaranteedLanding:false,
   computeUnitLimit:units,microLamportsPerCu:price,
   estimatedPriorityLamports:String(fee),
   estimatedBaseLamports:String(BASE_FEE_LAMPORTS),
   proposedTipLamports:String(tip),
   totalEstimatedFeesLamports:String(total),
   maxAdditionalFeeLamports:String(max),
   feePercentOf0p1Sol:Number(fee+tip)/100_000_000*100,
   observedSamples:i.samples.length,selectedPercentile:75,
   noBroadcastersConfigured:true
 }};
}
