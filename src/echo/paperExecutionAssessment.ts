/**
 * Conservative AlphaOS Echo research-only fill assessment.
 * A DEX market mark is NOT an executable price, pool reserves, fee quote or fill.
 * This module never imports wallets, signing or transaction-submission code.
 */
export type PaperExecutionEstimate = {
  status:'UNPRICED'|'INSUFFICIENT_LIQUIDITY'|'ESTIMATE_ONLY';
  executableVerified:false;
  stakeUsd:10;
  priceUsd:number|null;
  liquidityUsd:number|null;
  assumedFeesBpsPerSide:number;
  assumedSlippageBpsPerSide:number|null;
  totalAssumedBpsPerSide:number|null;
  hypotheticalTokens:number|null;
  hypotheticalExitUsd:number|null;
  hypotheticalNetPnlUsd:number|null;
  reason:string;
};
const STAKE=10;
const FEE_BPS=100;
/** Simulated risk screen only. Min liquidity and cost proxy are policy assumptions,
 * not verified market depth, reserves, or actual router execution quotes.
 */
export function assessPaperExecution(input:{
  entryUsd:number|null; exitUsd?:number|null; liquidityUsd:number|null;
  minLiquidityUsd?:number; assumedFeeBpsPerSide?:number;
}):PaperExecutionEstimate{
  const fee=input.assumedFeeBpsPerSide??FEE_BPS;
  if(!Number.isFinite(fee)||fee<0||fee>1000)throw Error('INVALID_ASSUMED_FEE');
  const base={stakeUsd:10 as const,executableVerified:false as const,
    priceUsd:input.entryUsd,liquidityUsd:input.liquidityUsd,assumedFeesBpsPerSide:fee};
  if(input.entryUsd===null||!Number.isFinite(input.entryUsd)||input.entryUsd<=0 ||
    input.liquidityUsd===null||!Number.isFinite(input.liquidityUsd)||input.liquidityUsd<=0)
    return {...base,status:'UNPRICED',assumedSlippageBpsPerSide:null,totalAssumedBpsPerSide:null,
      hypotheticalTokens:null,hypotheticalExitUsd:null,hypotheticalNetPnlUsd:null,
      reason:'NO_VERIFIABLE_MARK_OR_LIQUIDITY'} as const;
  const min=input.minLiquidityUsd??2000;
  if(!Number.isFinite(min)||min<=0)throw Error('INVALID_MIN_LIQUIDITY');
  if(input.liquidityUsd<min)return {...base,status:'INSUFFICIENT_LIQUIDITY',
    assumedSlippageBpsPerSide:null,totalAssumedBpsPerSide:null,
    hypotheticalTokens:null,hypotheticalExitUsd:null,hypotheticalNetPnlUsd:null,
    reason:'LIQUIDITY_BELOW_RESEARCH_FLOOR'} as const;
  // Pessimistic stand-in for trade-size impact; never label it a real quote.
  const impactBps=Math.min(1500,Math.ceil(STAKE/input.liquidityUsd*10000*2));
  const totalBps=fee+impactBps;
  const tokens=STAKE*(1-totalBps/10000)/input.entryUsd;
  const exit=input.exitUsd;
  const eligibleExit=exit!==undefined&&exit!==null&&Number.isFinite(exit)&&exit>0;
  const exitUsd=eligibleExit?tokens*exit!*(1-totalBps/10000):null;
  return {...base,status:'ESTIMATE_ONLY',assumedSlippageBpsPerSide:impactBps,
    totalAssumedBpsPerSide:totalBps,hypotheticalTokens:tokens,
    hypotheticalExitUsd:exitUsd,hypotheticalNetPnlUsd:exitUsd===null?null:exitUsd-STAKE,
    reason:'MARK_PRICE_WITH_ASSUMED_COSTS_NOT_EXECUTABLE_QUOTE'} as const;
}

/** No trading action is admitted by an estimate, even when estimated P/L is positive. */
export function paperEstimateAuthorizesTrading(_estimate:PaperExecutionEstimate):false{return false;}
