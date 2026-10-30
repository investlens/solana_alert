/** Manual-trade PREVIEW ONLY. Never sends transactions or controls signing.
 * Enforces owner authorization, age/expiry of externally simulated quote, reserve checks,
 * persistent token reservation evidence and hard-off code gates.
 */
import {validateBuyAdmission,type BuyAdmission,LIVE_EXECUTION_ENABLED,MAX_SOL_PER_BUY} from './liveBuyPolicy.js';
export type ManualPreview = {
 ownerChatId:string; requestChatId:string; ownerWallet:string;
 trade:BuyAdmission; quoteMint:string; quoteAtMs:number; quoteExpiresAtMs:number;
 simulationOk:boolean; simulationError?:string|null;
 walletBalanceSol:number; networkReserveSol:number;
 alreadyPurchasedToken:boolean; reservationState:'AVAILABLE'|'RESERVED'|'UNKNOWN';
};
export function reviewManualBuyPreview(input:ManualPreview,nowMs:number):{eligible:boolean;reason:string;executionEnabled:false}{
 const deny=(reason:string)=>({eligible:false,reason,executionEnabled:false as const});
 if(!input.ownerChatId||input.requestChatId!==input.ownerChatId)return deny('NOT_ADMIN');
 const admission=validateBuyAdmission(input.trade,input.ownerWallet);
 if('reason' in admission)return deny(admission.reason);
 if(input.quoteMint!==input.trade.mint)return deny('QUOTE_MINT_MISMATCH');
 if(!Number.isFinite(nowMs)||!Number.isFinite(input.quoteAtMs)||!Number.isFinite(input.quoteExpiresAtMs)||
    input.quoteAtMs>nowMs||nowMs-input.quoteAtMs>10_000||input.quoteExpiresAtMs<=nowMs)
    return deny('STALE_QUOTE');
 if(input.simulationOk!==true||input.simulationError)return deny('SIMULATION_NOT_VERIFIED');
 if(input.alreadyPurchasedToken||input.reservationState!=='AVAILABLE')return deny('TOKEN_ALREADY_RESERVED_OR_UNKNOWN');
 if(!Number.isFinite(input.walletBalanceSol)||!Number.isFinite(input.networkReserveSol)||
    input.networkReserveSol<0.005||input.trade.amountSol>MAX_SOL_PER_BUY||
    input.walletBalanceSol<input.trade.amountSol+input.networkReserveSol)
    return deny('INSUFFICIENT_SPENDABLE_BALANCE');
 if(!LIVE_EXECUTION_ENABLED)return deny('LIVE_EXECUTION_DISABLED');
 return deny('LIVE_EXECUTION_DISABLED');
}
export type ManualSellPreview={ownerChatId:string;requestChatId:string;percent:25|50|100;
 balanceVerified:boolean;simulated:boolean;simulationError?:string|null;automatic:boolean};
export function reviewManualSellPreview(v:ManualSellPreview):{eligible:false;reason:string}{
 if(!v.ownerChatId||v.requestChatId!==v.ownerChatId)return {eligible:false,reason:'NOT_ADMIN'};
 if(v.automatic)return {eligible:false,reason:'AUTO_SELL_FORBIDDEN'};
 if(![25,50,100].includes(v.percent))return {eligible:false,reason:'INVALID_PERCENT'};
 if(!v.balanceVerified||!v.simulated||v.simulationError)return {eligible:false,reason:'UNVERIFIED_SELL'};
 return {eligible:false,reason:'LIVE_EXECUTION_DISABLED'};
}
