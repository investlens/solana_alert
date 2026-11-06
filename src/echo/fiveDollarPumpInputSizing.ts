/** Deterministic $5 all-in PumpSwap INPUT sizing.
 * No RPC calls, signing or broadcast; only trusted fresh attestations supplied
 * by an independent quote+fee auditor may be used. Missing CPI, ATA or priority
 * fees MUST NOT be substituted with zero.
 *
 * Money math is integer lamports / cents and deliberately floors principal.
 */
export const ECHO_FIVE_USD_SIZING_SIGNING_ENABLED=false as const;
const CAP_CENTS=500n, BILLION=1_000_000_000n;
const decimal=(s:string):bigint|null=>
 typeof s==='string'&&/^(0|[1-9][0-9]{0,17})$/.test(s)?BigInt(s):null;
export type EchoPumpSizeInput={
 solUsdCents:string;
 networkAndPriorityFeeLamports:string;
 ataAndOtherAccountRentLamports:string;
 maximumAdditionalCpiDebitLamports:string;
 walletBalanceLamports:string;
 pendingReservedLamports:string;
 manualSellReserveLamports:string;
 freshFxVerified:boolean;
 completeFeeAndCpiAudit:boolean;
 freshWalletBalanceVerified:boolean;
 manualSellReserveVerified:boolean;
};
export type EchoPumpSizeResult=
 |{ok:true;signingAllowed:false;inputLamports:string;
   reservedAllInLamports:string;allInCentsCeiling:string}
 |{ok:false;reason:string;signingAllowed:false};
export function sizeEchoFiveUsdPumpInput(x:EchoPumpSizeInput):EchoPumpSizeResult{
 const fail=(reason:string):EchoPumpSizeResult=>({ok:false,reason,signingAllowed:false});
 if(!x.freshFxVerified||!x.completeFeeAndCpiAudit||
    !x.freshWalletBalanceVerified||!x.manualSellReserveVerified)
  return fail('INDEPENDENT_FX_FEES_BALANCE_OR_SELL_RESERVE_UNVERIFIED');
 const vals=[x.solUsdCents,x.networkAndPriorityFeeLamports,
  x.ataAndOtherAccountRentLamports,x.maximumAdditionalCpiDebitLamports,
  x.walletBalanceLamports,x.pendingReservedLamports,x.manualSellReserveLamports]
  .map(decimal);
 if(vals.some(v=>v===null))return fail('INVALID_OR_MISSING_LAMPORT_COST');
 const [price,network,rent,cpi,balance,pending,sell]=vals as bigint[];
 if(price<=0n||network<=0n||sell<=0n)
  return fail('MISSING_FX_NETWORK_FEE_OR_MANUAL_SELL_RESERVE');
 const costs=network+rent+cpi;
 // Maximum debit whose USD value ceiled to cents does not exceed $5:
 // (principal + costs) * SOL_USD_CENTS <= $5 * 1e9.
 const maxTotal=(CAP_CENTS*BILLION)/price;
 if(maxTotal<=costs)return fail('FEES_EXHAUST_FIVE_DOLLAR_ENTRY');
 const principal=maxTotal-costs;
 const available=balance-pending-sell;
 if(available<costs+principal)return fail('WALLET_CANNOT_COVER_FULL_FIVE_DOLLAR_BUY');
 if(principal<=0n||principal>100_000_000n)
  return fail('INVALID_SOL_INPUT_LIMIT');
 const total=principal+costs;
 const rounded=(total*price+BILLION-1n)/BILLION;
 if(rounded>CAP_CENTS)return fail('FIVE_DOLLAR_FX_OVERFLOW');
 return {ok:true,signingAllowed:false,inputLamports:String(principal),
  reservedAllInLamports:String(total),allInCentsCeiling:String(rounded)};
}
