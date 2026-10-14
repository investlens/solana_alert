export const boostPurchaseKey=(token:string,total:number)=>`${token.toLowerCase()}:${total}`;
import type {PendingBoost} from './pendingBoostRecovery.js';
import type {BoostVerificationRetry} from './alertEligibilityState.js';
// A completed older attempt cannot roll back observed totals or erase a newer
// attempt's recovery checkpoint/cooldown. Caller has already verified fan-out.
export function finishProtectedBoost(totals:Map<string,number>,pending:Map<string,PendingBoost>,retries:Map<string,BoostVerificationRetry>,key:string,total:number,attempt:PendingBoost){
 totals.set(key,Math.max(totals.get(key)??0,total));
 const purchase=boostPurchaseKey(key,total);
 if(pending.get(purchase)===attempt)pending.delete(purchase);
 if(retries.get(purchase)?.total===total)retries.delete(purchase);
}

import {classifyBoostCanonicalEvent,observeBoostCanonicalEvent} from './boostCanonicalEvent.js';
export function classifyBoostAttempt(totals:Map<string,number>,pending:Map<string,PendingBoost>,key:string,boost:{totalAmount:number;amount:number;source?:'LATEST'|'TOP'}){
 const exact=pending.get(boostPurchaseKey(key,boost.totalAmount));
 const prior=exact??[...pending.values()].filter(row=>row.tokenAddress.toLowerCase()===key.toLowerCase()).sort((a,b)=>b.totalAmount-a.totalAmount)[0];
 // Pin retries to their original identity and increment, even if a concurrent
 // older fan-out advances the observed baseline in the meantime.
 if(prior?.totalAmount===boost.totalAmount)return classifyBoostCanonicalEvent({previousTotal:prior.previousTotal,currentTotal:prior.totalAmount,feedAmount:prior.amount});
 // A genuinely observed pending total is also evidence for a newer increase;
 // delivery acknowledgement is not a prerequisite for observing a purchase.
 if(prior&&boost.totalAmount>prior.totalAmount)return classifyBoostCanonicalEvent({previousTotal:Math.max(totals.get(key)??0,prior.totalAmount),currentTotal:boost.totalAmount,feedAmount:boost.amount});
 return observeBoostCanonicalEvent(totals,key,boost.totalAmount,boost.amount,boost.source);
}
