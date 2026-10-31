/** AlphaOS Echo auto-BUY SHADOW screening only.
 * Independent policy evidence; this file must never send, sign, or reserve a trade.
 * For future execution, the signer and database must re-check every gate atomically.
 */
import {validateBuyAdmission,type BuyAdmission} from './liveBuyPolicy.js';
export const ECHO_SHADOW_AUTO_BUY_EXECUTION_ENABLED=false as const;
export const ECHO_AUTO_BUY_MAX_SOL=0.1;
export const ECHO_AUTO_BUY_MAX_SLIPPAGE_BPS=300;
export const ECHO_AUTO_BUY_MAX_PRICE_PREMIUM_BPS=300;
export const ECHO_AUTO_BUY_MAX_OPEN_POSITIONS=2;
export const ECHO_AUTO_BUY_DAILY_LOSS_BREAKER_SOL=0.15;
export const ECHO_AUTO_BUY_MAX_SIGNAL_AGE_MS=3_000;
export type EchoAutoBuyShadowInput={
 signal:BuyAdmission; executionWallet:string;
 nowMs:number; callerTradeAtMs:number; verifiedAtMs:number; quoteAtMs:number;
 callerEntryPriceSolPerToken:number; currentQuotePriceSolPerToken:number;
 quoteValid:boolean; unsignedSimulationPassed:boolean; accountsFullyResolved:boolean;
 sellRouteVerified:boolean; slippageBps:number;
 purchasedOrReservedMint:boolean; openOrPendingPositions:number;
 realizedLossSolToday:number; killSwitch:boolean;
};
export type EchoAutoBuyShadowResult=
 | {candidate:true;executable:false;reason:'SHADOW_ONLY';maxAmountSol:number}
 | {candidate:false;executable:false;reason:string};
export function screenEchoAutoBuyShadow(i:EchoAutoBuyShadowInput):EchoAutoBuyShadowResult {
 const deny=(reason:string):EchoAutoBuyShadowResult=>({candidate:false,executable:false,reason});
 if(i.killSwitch)return deny('KILL_SWITCH');
 const event=validateBuyAdmission(i.signal,i.executionWallet);
 if('reason' in event)return deny(event.reason);
 if(![i.nowMs,i.callerTradeAtMs,i.verifiedAtMs,i.quoteAtMs].every(Number.isSafeInteger)||
    i.callerTradeAtMs>i.verifiedAtMs||i.callerTradeAtMs>i.nowMs||
    i.nowMs-i.callerTradeAtMs>ECHO_AUTO_BUY_MAX_SIGNAL_AGE_MS||
    i.verifiedAtMs>i.nowMs||i.nowMs-i.verifiedAtMs>ECHO_AUTO_BUY_MAX_SIGNAL_AGE_MS)
  return deny('STALE_OR_UNVERIFIED_SIGNAL');
 if(i.quoteAtMs>i.nowMs||i.quoteAtMs<i.verifiedAtMs||i.nowMs-i.quoteAtMs>2_000)
  return deny('STALE_OR_UNVERIFIED_QUOTE');
 if(!Number.isSafeInteger(i.openOrPendingPositions)||i.openOrPendingPositions<0||
    i.openOrPendingPositions>=ECHO_AUTO_BUY_MAX_OPEN_POSITIONS)
  return deny('POSITION_LIMIT');
 if(i.purchasedOrReservedMint)return deny('DUPLICATE_MINT');
 if(!Number.isFinite(i.realizedLossSolToday)||i.realizedLossSolToday<0||
    i.realizedLossSolToday>=ECHO_AUTO_BUY_DAILY_LOSS_BREAKER_SOL)
  return deny('DAILY_LOSS_BREAKER');
 if(!Number.isSafeInteger(i.slippageBps)||i.slippageBps<1||
    i.slippageBps>ECHO_AUTO_BUY_MAX_SLIPPAGE_BPS)
  return deny('SLIPPAGE_CAP');
 if(![i.callerEntryPriceSolPerToken,i.currentQuotePriceSolPerToken].every(v=>Number.isFinite(v)&&v>0))
  return deny('PRICE_UNVERIFIED');
 const pricePremiumBps=(i.currentQuotePriceSolPerToken/i.callerEntryPriceSolPerToken-1)*10_000;
 if(!Number.isFinite(pricePremiumBps)||pricePremiumBps>ECHO_AUTO_BUY_MAX_PRICE_PREMIUM_BPS)
  return deny('PRICE_ALREADY_INFLATED');
 if(!i.quoteValid||!i.unsignedSimulationPassed||!i.accountsFullyResolved||!i.sellRouteVerified)
  return deny('ROUTE_OR_SIMULATION_UNVERIFIED');
 return {candidate:true,executable:false,reason:'SHADOW_ONLY',maxAmountSol:ECHO_AUTO_BUY_MAX_SOL};
}
