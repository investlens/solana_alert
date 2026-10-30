/** AlphaOS Echo manual trading request *admission only*.
 * No wallet imports, transaction building, signing, or executor calls.
 * A valid admission is not permission to submit a trade.
 */
import { MAX_SOL_PER_BUY } from './liveBuyPolicy.js';
const solanaAddress=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
type Request = {requesterChatId:string;ownerChatId:string;wallet:string;mint:string;
  action:'BUY'|'SELL';amountSol?:number;percent?:number;confirmed:boolean;
  nonce:string;};
type Decision = {accepted:false;reason:string}|{accepted:true;reservationKey:string;executionEnabled:false};
export function validateManualTradeIntent(r:Request):Decision {
 if(!/^[1-9]\d*$/.test(r.ownerChatId)||r.requesterChatId!==r.ownerChatId)
   return {accepted:false,reason:'OWNER_ONLY'};
 if(!solanaAddress.test(r.wallet)||!solanaAddress.test(r.mint)||!r.nonce||r.nonce.length>120)
   return {accepted:false,reason:'INVALID_REQUEST'};
 if(!r.confirmed)return {accepted:false,reason:'EXPLICIT_CONFIRMATION_REQUIRED'};
 if(r.action==='BUY'){
   if(!Number.isFinite(r.amountSol)||r.amountSol!<=0||r.amountSol!>MAX_SOL_PER_BUY ||
      r.percent!==undefined)return {accepted:false,reason:'INVALID_BUY_SIZE'};
 } else if(r.action==='SELL') {
   if(![25,50,100].includes(r.percent??0)||r.amountSol!==undefined)
      return {accepted:false,reason:'INVALID_SELL_PERCENT'};
 } else return {accepted:false,reason:'INVALID_SIDE'};
 return {accepted:true,reservationKey:r.wallet+':'+r.mint,executionEnabled:false};
}
/** A separate persistent unique (wallet,mint) reservation is mandatory BEFORE
 * any eventual BUY signing. This intentionally never authorizes execution. */
export const MANUAL_TRANSACTION_SUBMISSION_ENABLED=false as const;
export const AUTOMATIC_SELL_ENABLED=false as const;
