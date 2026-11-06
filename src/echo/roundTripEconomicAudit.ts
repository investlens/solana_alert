/** Strict read-only economic accounting for an Echo buy-and-manual-sell cycle.
 * No wallet keys, no signing, no broadcasts, no funding instructions.
 * Signed base-unit integers only: paper profit cannot be claimed from a
 * hypothetical quote, and unknown fees force a no-go result.
 */
export const ECHO_ECONOMIC_AUDIT_ALLOWS_TRADING=false as const;
const MAX_SOL_LAMPORTS=100_000_000n;
const MAX_ADDITIONAL_FEE=500_000n;
const MAX_SLIPPAGE_BPS=1000n;
export type EchoFeeScenario={
  buyLamports:string; sellExpectedLamports:string;
  /** Trusted source for venue fees on BOTH sides. Null blocks evaluation. */
  pumpBuyBps:number|null;pumpSellBps:number|null;
  builderBuyBps:number|null;builderSellBps:number|null;
  buyPriorityLamports:string|null;sellPriorityLamports:string|null;
  buySignatureLamports:string|null;sellSignatureLamports:string|null;
  rentOrAtaLamports:string|null;
  buySlippageBps:number|null;sellSlippageBps:number|null;
  /** Expected sell SOL must come from a fresh independently verified route. */
  buyAndSellQuoteIndependent:boolean;
};
export type EchoFeeReport={
  ok:boolean;reason:string;mode:'READ_ONLY';signingApproved:false;
  grossProceedsLamports?:string;buyTotalLamports?:string;
  netProceedsLamports?:string;profitLamports?:string;
  roiBps?:number;networkAndPriorityLamports?:string;
  venueFeesLamports?:string;rentLamports?:string;
};
const fail=(reason:string):EchoFeeReport=>({ok:false,reason,mode:'READ_ONLY',signingApproved:false});
const parsed=(n:string|null)=>n!==null&&/^(0|[1-9][0-9]{0,17})$/.test(n)?BigInt(n):null;
const charge=(amount:bigint,bps:bigint)=> (amount*bps+9999n)/10000n;
const validBps=(x:number|null,max:number)=>x!==null&&Number.isSafeInteger(x)&&x>=0&&x<=max;
export function reviewEchoRoundTripEconomics(x:EchoFeeScenario):EchoFeeReport{
 if(!x.buyAndSellQuoteIndependent)return fail('INDEPENDENT_BUY_AND_SELL_QUOTES_REQUIRED');
 const spend=parsed(x.buyLamports),gross=parsed(x.sellExpectedLamports);
 if(spend===null||gross===null||spend<1n||spend>MAX_SOL_LAMPORTS)
  return fail('INVALID_0P1_SOL_TRADE_SIZE_OR_PROCEEDS');
 const costs=[x.buyPriorityLamports,x.sellPriorityLamports,
  x.buySignatureLamports,x.sellSignatureLamports,x.rentOrAtaLamports].map(parsed);
 if(costs.some(v=>v===null))return fail('NETWORK_OR_RENT_COST_UNKNOWN');
 const [buyPriority,sellPriority,buySignature,sellSignature,rent]=costs as bigint[];
 if(buyPriority+sellPriority>MAX_ADDITIONAL_FEE)
  return fail('ROUND_TRIP_PRIORITY_FEE_BUDGET_EXCEEDED');
 if(![x.pumpBuyBps,x.pumpSellBps,x.builderBuyBps,x.builderSellBps]
  .every(v=>validBps(v,1000)))return fail('VENUE_FEE_UNVERIFIED');
 if(!validBps(x.buySlippageBps,1000)||!validBps(x.sellSlippageBps,1000))
  return fail('SLIPPAGE_UNVERIFIED_OR_EXCESSIVE');
 const venueBuy=charge(spend,BigInt(x.pumpBuyBps!+x.builderBuyBps!));
 const venueSell=charge(gross,BigInt(x.pumpSellBps!+x.builderSellBps!));
 const slippageBuy=charge(spend,BigInt(x.buySlippageBps!));
 const slippageSell=charge(gross,BigInt(x.sellSlippageBps!));
 const network=buyPriority+sellPriority+buySignature+sellSignature;
 const buyTotal=spend+venueBuy+slippageBuy+buySignature+buyPriority+rent;
 const netProceeds=gross-venueSell-slippageSell-sellSignature-sellPriority;
 const profit=netProceeds-buyTotal;
 // This models rent as a conservative expense, not a recoverable rebate.
 const roiBps=Number(profit*10000n/buyTotal);
 return {ok:true,reason:profit>0n?'SIMULATED_PROFIT_AFTER_IDENTIFIED_FEES':'NO_POSITIVE_EXPECTED_RETURN',
  mode:'READ_ONLY',signingApproved:false,
  grossProceedsLamports:String(gross),buyTotalLamports:String(buyTotal),
  netProceedsLamports:String(netProceeds),profitLamports:String(profit),
  roiBps,networkAndPriorityLamports:String(network),
  venueFeesLamports:String(venueBuy+venueSell),rentLamports:String(rent)};
}
