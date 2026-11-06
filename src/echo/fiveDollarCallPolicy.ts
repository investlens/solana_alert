/** Proposed $5 all-in per DISTINCT verified caller BUY, not live execution.
 * Deliberately isolated from the existing $10/$30 production pilot. A call
 * source signature is the idempotency unit; a mint is NOT the idempotency unit.
 * Missing economic, route, custody or balance proofs always fail closed.
 */
import {CHAIRMAN_WALLET,SLINGOOR_WALLET} from './liveBuyPolicy.js';
import {verifyEchoExecutionWallet} from './executionWallet.js';

export const ECHO_CALL_ENTRY_CAP_CENTS=500n;
export const ECHO_FIVE_DOLLAR_CALL_BROADCAST_ENABLED=false as const;
const base58=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const signature=/^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const parse=(s:string):bigint|null=>
 typeof s==='string'&&/^(0|[1-9][0-9]{0,17})$/.test(s)?BigInt(s):null;
const ceilDiv=(a:bigint,b:bigint)=>(a+b-1n)/b;
export type EchoFiveDollarCall={
 executionWallet:string;callerWallet:string;mint:string;sourceSignature:string;
 side:'BUY'|'SELL';verifiedCallerSigner:boolean;verifiedSwap:boolean;
 verifiedSpend:boolean;verifiedTokenCredit:boolean;isTransferOrGift:boolean;
 marketCapUsd:number;callerPriceSolPerToken:number;buyPriceSolPerToken:number;
 maxSlippageBps:number;observedAtMs:number;nowMs:number;
 marketCapObservedAtMs:number;balanceVerifiedAtMs:number;solUsdObservedAtMs:number;
 // Fully independently attested wallet debit (excluding manual sell reserve).
 principalLamports:string;networkAndPriorityFeeLamports:string;
 accountRentLamports:string;additionalCpiDebitLamports:string;
 sellReserveLamports:string;pendingWalletDebitLamports:string;
 availableWalletLamports:string;solUsdPriceCents:string;
 exactMessageAndCpiAudited:boolean;manualSellRouteAndReserveVerified:boolean;
 walletBalanceAndFxVerified:boolean;durableReservationAvailable:boolean;
 killSwitch:boolean;openOrPendingLots:number;
 // These keys are drawn from durable source-signature DB records, NOT alerts
 // in memory; the DB also independently enforces this same uniqueness.
 sourceTransactionAlreadyReserved:boolean;
};
export type EchoFiveDollarDecision=
 |{eligible:true;executable:false;reason:'PER_CALL_PREFLIGHT_ONLY';
    intentKey:string;principalLamports:string;allInCents:string;requiredLamports:string}
 |{eligible:false;executable:false;reason:string};
export function screenEchoFiveDollarCall(c:EchoFiveDollarCall):EchoFiveDollarDecision{
 const deny=(reason:string):EchoFiveDollarDecision=>({eligible:false,executable:false,reason});
 if(c.killSwitch)return deny('KILL_SWITCH');
 if(!verifyEchoExecutionWallet(c.executionWallet)||!base58.test(c.mint)||
   !signature.test(c.sourceSignature)||![SLINGOOR_WALLET,CHAIRMAN_WALLET].includes(c.callerWallet))
   return deny('UNTRUSTED_CALLER_OR_IDENTIFIERS');
 if(c.side!=='BUY'||c.isTransferOrGift||!c.verifiedCallerSigner||
   !c.verifiedSwap||!c.verifiedSpend||!c.verifiedTokenCredit)
   return deny('NOT_VERIFIED_CALLER_BUY');
 if(c.sourceTransactionAlreadyReserved)return deny('DUPLICATE_SOURCE_TRANSACTION');
 if(!Number.isSafeInteger(c.nowMs)||!Number.isSafeInteger(c.observedAtMs)||
   c.observedAtMs>c.nowMs||c.nowMs-c.observedAtMs>75_000)
   return deny('STALE_CALL');
 for(const [t,maxAge] of [
   [c.marketCapObservedAtMs,2000],
   [c.balanceVerifiedAtMs,3000],
   [c.solUsdObservedAtMs,3000]
 ]){
   if(!Number.isSafeInteger(t)||t>c.nowMs||c.nowMs-t>maxAge)
     return deny('STALE_MARKET_CAP_WALLET_OR_FX_ATTESTATION');
 }
 if(!Number.isFinite(c.marketCapUsd)||c.marketCapUsd<=0||c.marketCapUsd>500_000)
   return deny('MARKET_CAP_NOT_ELIGIBLE');
 if(!Number.isFinite(c.callerPriceSolPerToken)||c.callerPriceSolPerToken<=0||
   !Number.isFinite(c.buyPriceSolPerToken)||c.buyPriceSolPerToken<=0||
   c.buyPriceSolPerToken>c.callerPriceSolPerToken*1.5)
   return deny('PRICE_PREMIUM_NOT_ELIGIBLE');
 if(!Number.isSafeInteger(c.maxSlippageBps)||c.maxSlippageBps<1||
   c.maxSlippageBps>1000)return deny('SLIPPAGE_EXCEEDED');
 if(!c.durableReservationAvailable)return deny('ATOMIC_RESERVATION_UNAVAILABLE');
 // Multiple open lots are permitted. Still reject inconsistent ledger
 // observations; actual wallet balance and all pending debits must be audited.
 if(!Number.isSafeInteger(c.openOrPendingLots)||c.openOrPendingLots<0)
   return deny('INVALID_OPEN_LOT_COUNT');
 // Defense in depth: the atomic wallet-wide DB reservation must separately
 // enforce this cap under concurrency. Never rely on this snapshot alone.
 if(c.openOrPendingLots>=2)return deny('TWO_ACTIVE_OR_PENDING_LOTS_LIMIT');
 if(!c.exactMessageAndCpiAudited)return deny('UNVERIFIED_EXACT_WALLET_DEBIT');
 if(!c.manualSellRouteAndReserveVerified)return deny('MANUAL_SELL_RESERVE_UNVERIFIED');
 if(!c.walletBalanceAndFxVerified)return deny('BALANCE_OR_FX_UNVERIFIED');
 const p=parse(c.principalLamports),n=parse(c.networkAndPriorityFeeLamports),
   rent=parse(c.accountRentLamports),cpi=parse(c.additionalCpiDebitLamports),
   sell=parse(c.sellReserveLamports),pending=parse(c.pendingWalletDebitLamports),
   balance=parse(c.availableWalletLamports),price=parse(c.solUsdPriceCents);
 if([p,n,rent,cpi,sell,pending,balance,price].some(v=>v===null))
   return deny('INVALID_WALLET_ECONOMICS');
 if(p===0n||n===0n||sell===0n||price===0n)return deny('MISSING_PRINCIPAL_FEE_OR_SELL_RESERVE');
 // No $6 or other arbitrary wallet-balance trigger. The signer still needs
 // enough actual SOL for this exact BUY, concurrent commitments and exit costs.
 const buyDebit=p!+n!+rent!+cpi!;
 if(buyDebit<=0n)return deny('INVALID_WALLET_DEBIT');
 const allInCents=ceilDiv(buyDebit*price!,1_000_000_000n);
 if(allInCents>ECHO_CALL_ENTRY_CAP_CENTS)return deny('FIVE_DOLLAR_ALL_IN_CAP');
 const required=buyDebit+sell!+pending!;
 if(balance!<required)return deny('INSUFFICIENT_WALLET_BALANCE_AND_EXIT_RESERVE');
 const intentKey=[c.executionWallet,c.callerWallet,c.sourceSignature,c.mint].join(':');
 return {eligible:true,executable:false,reason:'PER_CALL_PREFLIGHT_ONLY',intentKey,
  principalLamports:String(p),allInCents:String(allInCents),requiredLamports:String(required)};
}
