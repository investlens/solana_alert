import type {DexPaidCheckOutcome} from '../chains/robinhood/dexPaidDiagnostics.js';
// A verified order is not a completed delivery. Existing per-recipient claims
// remain authoritative; this classification never initiates a Telegram send.
export function promotionDeliveryResult(result:{delivered:number;failed:number}):{complete:boolean;outcome:DexPaidCheckOutcome} {
 const valid=Number.isSafeInteger(result.delivered)&&result.delivered>=0&&Number.isSafeInteger(result.failed)&&result.failed>=0;
 if(!valid||result.failed>0)return {complete:false,outcome:'DELIVERY_FAILURE'};
 return result.delivered>0?{complete:true,outcome:'TELEGRAM_ACCEPTED'}:{complete:false,outcome:'NO_DELIVERY'};
}
