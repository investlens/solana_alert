/** Package 2: independently reviewed manual SELL reserve for ALL open lots.
 * One future SELL receipt cannot be shared by two outstanding positions.
 * No Phantom interaction, signing, wallet send or DB changes.
 */
import {ECHO_EXPECTED_EXECUTION_WALLET} from './executionWallet.js';
import {reviewEchoPhantomSellReserve,type EchoPhantomSellQuote}
 from './phantomSellReserveReview.js';
export const ECHO_PORTFOLIO_EXIT_RESERVE_CAN_SELL=false as const;
const dec=(x:string):bigint|null=>/^(0|[1-9][0-9]{0,17})$/.test(x)?BigInt(x):null;
export type EchoOpenManualExitLot={
 sourceSignature:string;wallet:string;mint:string;
 quote:EchoPhantomSellQuote|null;
};
export type EchoPortfolioExitResult=
 |{ok:true;mode:'READ_ONLY_PORTFOLIO_EXIT_BUDGET';
   requiredExitReserveLamports:string;totalExistingWalletLamports:string;
   realPhantomSellVerified:false;signingAllowed:false;broadcastAllowed:false}
 |{ok:false;reason:string;signingAllowed:false;broadcastAllowed:false};
const no=(reason:string):EchoPortfolioExitResult=>({
 ok:false,reason,signingAllowed:false,broadcastAllowed:false
});
/** Existing capital reserve belongs to BUYs, not future speculative SELL proceeds. */
export function reviewEchoPortfolioExitReserve(input:{
 wallet:string;openLots:EchoOpenManualExitLot[];
 actualWalletBalanceLamports:string;
 pendingBuyCommitmentsLamports:string;
 nowMs:number;
}):EchoPortfolioExitResult{
 if(input.wallet!==ECHO_EXPECTED_EXECUTION_WALLET||
    !Number.isSafeInteger(input.nowMs))
  return no('INVALID_PORTFOLIO_WALLET_OR_TIMESTAMP');
 const balance=dec(input.actualWalletBalanceLamports);
 const pending=dec(input.pendingBuyCommitmentsLamports);
 if(balance===null||pending===null)return no('UNKNOWN_WALLET_OR_PENDING_DEBITS');
 if(input.openLots.length>2)return no('TWO_OPEN_LOT_EXIT_RESERVE_LIMIT');
 const ids=new Set<string>();
 let reserve=0n;
 for(const lot of input.openLots){
  if(lot.wallet!==input.wallet||
     !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(lot.sourceSignature)||
     ids.has(lot.sourceSignature)||!lot.quote)
   return no('MISSING_DUPLICATE_OR_FOREIGN_EXIT_LOT');
  ids.add(lot.sourceSignature);
  if(lot.quote.wallet!==lot.wallet||lot.quote.mint!==lot.mint||
     lot.quote.nowMs!==input.nowMs||
     lot.quote.existingReservedExitLamports!=='0'||
     lot.quote.walletSolBalanceLamports!==input.actualWalletBalanceLamports)
   return no('EXIT_QUOTE_IDENTITY_OR_DOUBLE_COUNT');
  // Each lot is priced without subtracting other positions inside this
  // per-lot quote. The portfolio sums them exactly once.
  const r=reviewEchoPhantomSellReserve(lot.quote);
  if(!r.ok)return no('EXIT_QUOTE_UNVERIFIED');
  const value=dec(r.requiredLamports);
  if(value===null)return no('INVALID_EXIT_COST');
  reserve+=value;
 }
 if(balance<reserve+pending)
  return no('INSUFFICIENT_SOL_FOR_ALL_EXITS_AND_PENDING_BUYS');
 return {ok:true,mode:'READ_ONLY_PORTFOLIO_EXIT_BUDGET',
  requiredExitReserveLamports:String(reserve),
  totalExistingWalletLamports:String(balance),
  realPhantomSellVerified:false,signingAllowed:false,broadcastAllowed:false};
}
