import { CHAIRMAN_WALLET, SLINGOOR_WALLET } from './liveBuyPolicy.js';

/** Pre-execution admission, not an authorization to sign or broadcast.
 * Quote prices are independent market data and must be validated again at execution.
 */
const ALLOWED_CALLERS = new Set([SLINGOOR_WALLET, CHAIRMAN_WALLET]);
export const ECHO_PILOT_STAKE_USD = 10;
export const ECHO_PILOT_MAX_BUYS_PER_DAY = 3;
export const ECHO_PILOT_MAX_OPEN_POSITIONS = 2;
export const ECHO_PILOT_MAX_OPEN_PRINCIPAL_USD = 20;
export const ECHO_PILOT_AUTO_SELL_ENABLED = false as const;
export const ECHO_PILOT_BROADCAST_ENABLED = false as const;

export type PilotOrder = {
 callerWallet:string; mint:string; verifiedBuyerSigner:boolean;
 originalSwapSucceeded:boolean; verifiedSpend:boolean; verifiedTokenCredit:boolean;
 priceSolUsd:number; priceObservedAtMs:number; nowMs:number;
 spentOrdersToday:number; openOrPendingPositions:number; openOrPendingPrincipalUsd:number;
 alreadyReservedOrPurchased:boolean;
 killSwitchEngaged:boolean; maxFeeLamports:number;
};
export type PilotDecision =
 | {allowed:true; amountLamports:number; principalUsd:10}
 | {allowed:false;reason:string};
export function screenEchoTenDollarPilot(order:PilotOrder):PilotDecision {
 const reject=(reason:string):PilotDecision=>({allowed:false,reason});
 if(order.killSwitchEngaged)return reject('KILL_SWITCH');
 if(!ALLOWED_CALLERS.has(order.callerWallet))return reject('CALLER_NOT_ALLOWED');
 if(!order.verifiedBuyerSigner||!order.originalSwapSucceeded||
   !order.verifiedSpend||!order.verifiedTokenCredit)return reject('UNVERIFIED_CALLER_BUY');
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(order.mint))return reject('INVALID_MINT');
 if(order.alreadyReservedOrPurchased)return reject('TOKEN_ALREADY_RESERVED');
 // Count pending and uncertain submissions as occupied slots until chain reconciliation.
 if(!Number.isSafeInteger(order.openOrPendingPositions)||order.openOrPendingPositions<0||
   order.openOrPendingPositions>=ECHO_PILOT_MAX_OPEN_POSITIONS)return reject('MAX_TWO_OPEN_TRADES');
 if(!Number.isFinite(order.openOrPendingPrincipalUsd)||order.openOrPendingPrincipalUsd<0||
   order.openOrPendingPrincipalUsd+ECHO_PILOT_STAKE_USD>ECHO_PILOT_MAX_OPEN_PRINCIPAL_USD)
   return reject('MAX_TWENTY_DOLLARS_EXPOSURE');
 if(!Number.isSafeInteger(order.spentOrdersToday)||order.spentOrdersToday<0||
    order.spentOrdersToday>=ECHO_PILOT_MAX_BUYS_PER_DAY)return reject('DAILY_TRADE_LIMIT');
 if(!Number.isSafeInteger(order.nowMs)||!Number.isSafeInteger(order.priceObservedAtMs)||
   order.priceObservedAtMs>order.nowMs||order.nowMs-order.priceObservedAtMs>3000)
   return reject('STALE_SOL_USD_PRICE');
 if(!Number.isFinite(order.priceSolUsd)||order.priceSolUsd<=0)return reject('INVALID_SOL_USD_PRICE');
 if(!Number.isSafeInteger(order.maxFeeLamports)||order.maxFeeLamports<0||order.maxFeeLamports>1_000_000)
   return reject('EXCESSIVE_FEE_BUDGET');
 const amountLamports=Math.round(ECHO_PILOT_STAKE_USD/order.priceSolUsd*1e9);
 if(!Number.isSafeInteger(amountLamports)||amountLamports<=0||amountLamports>100_000_000)
   return reject('EXCEEDS_0_1_SOL_HARD_CAP');
 return {allowed:true,amountLamports,principalUsd:10};
}
