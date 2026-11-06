/**
 * AlphaOS Echo: strict, read-only funding admission for one 0.025 SOL pilot BUY.
 * All numbers are exact unsigned decimal strings in lamports/cents.
 *
 * This is not a quote, a funding instruction, a signature or trade approval.
 * The caller must independently audit CPI wallet debits and future manual-SELL
 * reserve from the EXACT transaction / chain state before any approval.
 */
export const ECHO_FUNDING_GATE_ALLOWS_TRADING=false as const;
const PRINCIPAL=25_000_000n, MAX_SOL=1_000_000_000_000n;
const MAX_ORDER_CENTS=1000n, MAX_LIFETIME_CENTS=3000n;
type Decimal=string|null;
export type EchoFullWalletFundingInput={
 swapInputLamports:Decimal;
 exactMessageFeeLamports:Decimal;
 /** Actual payer-funded ATA + other account creation rents, audited once. */
 accountCreationRentLamports:Decimal;
 /** Extra lamports paid by the wallet in inner/CPI transfer paths;
  * exclude the swap principal and account rents already counted above. */
 extraCpiWalletDebitLamports:Decimal;
 manualSellFeeAndRentReserveLamports:Decimal;
 otherPendingCommitmentsLamports:Decimal;
 walletBalanceLamports:Decimal;
 solUsdPriceCents:Decimal;
 alreadyCommittedLifetimeCents:Decimal;
 independentlyAuditedExactMessage:boolean;
 independentCpiAndAccountRentAudit:boolean;
 independentSellReserveAudit:boolean;
 freshWalletBalanceAndFxAttestation:boolean;
};
export type EchoFullWalletFundingReport={
 ok:boolean;reason:string;signingApproved:false;broadcastApproved:false;
 requiredFundingLamports?:string;walletShortfallLamports?:string;
 oneBuyAllInLamports?:string;oneBuyAllInUsdCents?:string;
 lifetimeCommittedAfterCents?:string
};
const fail=(reason:string):EchoFullWalletFundingReport=>({
 ok:false,reason,signingApproved:false,broadcastApproved:false
});
const parse=(x:Decimal):bigint|null=>{
 if(typeof x!=='string'||!/^(0|[1-9][0-9]{0,17})$/.test(x))return null;
 const n=BigInt(x);return n<=MAX_SOL?n:null;
};
const ceilDiv=(a:bigint,b:bigint)=>(a+b-1n)/b;
export function reviewEchoFullWalletFunding(
 x:EchoFullWalletFundingInput
):EchoFullWalletFundingReport{
 const input=parse(x.swapInputLamports),fee=parse(x.exactMessageFeeLamports),
  rent=parse(x.accountCreationRentLamports),cpi=parse(x.extraCpiWalletDebitLamports),
  sell=parse(x.manualSellFeeAndRentReserveLamports),
  pending=parse(x.otherPendingCommitmentsLamports),
  balance=parse(x.walletBalanceLamports),
  solUsdCents=parse(x.solUsdPriceCents),
  committed=parse(x.alreadyCommittedLifetimeCents);
 if([input,fee,rent,cpi,sell,pending,balance,solUsdCents,committed]
    .some(v=>v===null))return fail('MISSING_OR_INVALID_WALLET_COST_EVIDENCE');
 if(input!==PRINCIPAL)return fail('PILOT_PRINCIPAL_MUST_BE_0P025_SOL');
 if(!x.independentlyAuditedExactMessage)return fail('EXACT_MESSAGE_FEE_UNVERIFIED');
 if(!x.independentCpiAndAccountRentAudit)return fail('CPI_OR_ACCOUNT_RENT_UNVERIFIED');
 if(!x.independentSellReserveAudit)return fail('MANUAL_SELL_RESERVE_UNVERIFIED');
 if(!x.freshWalletBalanceAndFxAttestation)return fail('WALLET_BALANCE_OR_FX_UNVERIFIED');
 if(fee===0n||sell===0n||solUsdCents===0n)
  return fail('NONZERO_FEE_EXIT_AND_FX_REQUIRED');
 const buyCost=PRINCIPAL+fee!+rent!+cpi!;
 const required=buyCost+sell!+pending!;
 if(required>MAX_SOL)return fail('OUT_OF_RANGE_TOTAL_WALLET_DEBIT');
 // Ceil USD cents to avoid underestimating the all-in entry ceiling.
 const oneBuyCents=ceilDiv(buyCost*solUsdCents!,1_000_000_000n);
 if(oneBuyCents>MAX_ORDER_CENTS)return fail('TEN_DOLLAR_ALL_IN_ORDER_CAP');
 if(committed!+oneBuyCents>MAX_LIFETIME_CENTS)
  return fail('THIRTY_DOLLAR_LIFETIME_CAP');
 const shortfall=required>balance!?required-balance!:0n;
 if(shortfall>0n)return {ok:false,reason:'UNFUNDED_FOR_FULL_BUY_AND_SELL_RESERVE',
  signingApproved:false,broadcastApproved:false,
  requiredFundingLamports:String(required),
  walletShortfallLamports:String(shortfall),
  oneBuyAllInLamports:String(buyCost),
  oneBuyAllInUsdCents:String(oneBuyCents)};
 return {ok:true,reason:'READ_ONLY_COST_ENVELOPE_WITHIN_LIMITS_NOT_EXECUTION_APPROVAL',
  signingApproved:false,broadcastApproved:false,
  requiredFundingLamports:String(required),walletShortfallLamports:'0',
  oneBuyAllInLamports:String(buyCost),oneBuyAllInUsdCents:String(oneBuyCents),
  lifetimeCommittedAfterCents:String(committed!+oneBuyCents)};
}
