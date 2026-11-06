/** Read-only guard for a independently retrieved Phantom-compatible SELL quote.
 * A quote cannot guarantee that Phantom will show/execute the same transaction.
 * No real sell, key, signing or RPC send. Requires independent snapshot,
 * exact route/token identity, explicit max fee/rent and dedicated exit SOL.
 */
import {ECHO_EXPECTED_EXECUTION_WALLET} from './executionWallet.js';
export const ECHO_SELL_RESERVE_CAN_SELL=false as const;
const dec=(v:string):bigint|null=>typeof v==='string'&&/^(0|[1-9][0-9]{0,17})$/.test(v)?BigInt(v):null;
const mint=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export type EchoPhantomSellQuote={
 wallet:string;mint:string;outputMint:string;quoteObservedAtMs:number;nowMs:number;
 walletTokenBalanceRaw:string;quotedSellInputRaw:string;minimumSolOutputLamports:string;
 networkAndPriorityFeeUpperLamports:string;accountRentUpperLamports:string;
 extraCpiUpperLamports:string;walletSolBalanceLamports:string;
 existingReservedExitLamports:string; // other existing lots
 quoteIndependentlyFetched:boolean;feeAndCpiIndependentlyBounded:boolean;
 poolAndTokenOwnersVerified:boolean;exactManualTransactionPreviewVerified:boolean;
};
export type EchoPhantomExitReserveReview=
 |{ok:true;mode:'READ_ONLY_MANUAL_EXIT_RESERVE';requiredLamports:string;
   quoteExpiresAtMs:number;verifiedRealPhantomSell:false;
   signingAllowed:false;broadcastAllowed:false}
 |{ok:false;reason:string;signingAllowed:false;broadcastAllowed:false};
const no=(reason:string):EchoPhantomExitReserveReview=>({
 ok:false,reason,signingAllowed:false,broadcastAllowed:false
});
export function reviewEchoPhantomSellReserve(x:EchoPhantomSellQuote):EchoPhantomExitReserveReview{
 if(x.wallet!==ECHO_EXPECTED_EXECUTION_WALLET||!mint.test(x.mint)||
    x.outputMint!=='So11111111111111111111111111111111111111112')
  return no('UNTRUSTED_EXIT_ROUTE');
 if(!Number.isSafeInteger(x.nowMs)||!Number.isSafeInteger(x.quoteObservedAtMs)||
    x.quoteObservedAtMs>x.nowMs||x.nowMs-x.quoteObservedAtMs>2000)
  return no('STALE_SELL_QUOTE');
 if(!x.quoteIndependentlyFetched||!x.feeAndCpiIndependentlyBounded||
    !x.poolAndTokenOwnersVerified||!x.exactManualTransactionPreviewVerified)
  return no('INDEPENDENT_PHANTOM_SELL_EVIDENCE_REQUIRED');
 const raw=[x.walletTokenBalanceRaw,x.quotedSellInputRaw,x.minimumSolOutputLamports,
  x.networkAndPriorityFeeUpperLamports,x.accountRentUpperLamports,
  x.extraCpiUpperLamports,x.walletSolBalanceLamports,
  x.existingReservedExitLamports].map(dec);
 if(raw.some(n=>n===null))return no('INVALID_EXIT_LAMPORTS_OR_TOKENS');
 const [held,quantity,minOut,fee,rent,cpi,balance,other]=raw as bigint[];
 if(held===0n||quantity!==held||minOut===0n||fee===0n)
  return no('NO_VERIFIED_FULL_EXIT_OR_NETWORK_FEE');
 // Never fund the sale using speculative future SOL proceeds.
 const cost=fee+rent+cpi;
 if(cost===0n||balance<cost+other)
  return no('INSUFFICIENT_PRE_SELL_SOL_RESERVE');
 return {ok:true,mode:'READ_ONLY_MANUAL_EXIT_RESERVE',
  requiredLamports:String(cost),quoteExpiresAtMs:x.quoteObservedAtMs+2000,
  verifiedRealPhantomSell:false,signingAllowed:false,broadcastAllowed:false};
}
