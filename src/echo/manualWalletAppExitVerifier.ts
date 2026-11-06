/** Read-only verification of a manual wallet-app SELL (e.g. Phantom).
 * No Telegram SELL, signing, RPC send, or database mutations. A future
 * privileged transaction coordinator MUST independently fetch the finalized
 * chain transaction and token-account balance; no caller-supplied receipts.
 * Treat this proof as a prerequisite for a separately reviewed atomic SQL
 * slot-close operation, NEVER as permission to directly release a slot.
 */
import {observeEchoReceipt,type EchoReceipt} from './observedRoundTripReceipts.js';
import {verifyEchoExecutionWallet} from './executionWallet.js';

export const ECHO_EXTERNAL_SELL_SLOT_RELEASE_ENABLED=false as const;
export interface EchoVerifiedExternalSellEvidence {
 buySignature:string;
 /** Prior confirmed BUY reservation from trusted server-side database. */
 buyState:'confirmed'|'reserved'|'submitted'|'unknown';
 alreadyClosed:boolean;
 wallet:string;mint:string;
 /** Independently fetched from finalized chain transaction by trusted adapter. */
 sellReceipt:EchoReceipt;
 /** Independently queried after finalization for the very same wallet + mint. */
 currentHeldTokenBalanceRaw:string;
 currentBalanceSlot:number;
 sellFinalizedSlot:number;
 /** Independent verified source of truth, not a user-supplied boolean. */
 finalizedChainProofVerified:boolean;
}
export type EchoExternalSellVerification=
 | {ok:true;mode:'READ_ONLY_EXIT_PROOF';wallet:string;mint:string;
    sellSignature:string;soldTokenUnitsRaw:string;netWalletSolIncreaseLamports:string;
    safeToRequestDbClose:true;slotReleased:false}
 | {ok:false;reason:string;slotReleased:false};

const signature=/^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
export function verifyEchoManualWalletAppExit(
 x:EchoVerifiedExternalSellEvidence
):EchoExternalSellVerification {
 const reject=(reason:string):EchoExternalSellVerification=>({ok:false,reason,slotReleased:false});
 if(!verifyEchoExecutionWallet(x.wallet)||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x.mint)||
    !signature.test(x.buySignature)||x.buySignature===x.sellReceipt?.signature)
  return reject('RESERVATION_IDENTITY_MISMATCH');
 if(x.buyState!=='confirmed'||x.alreadyClosed)return reject('BUY_POSITION_NOT_OPEN_AND_CONFIRMED');
 if(!x.finalizedChainProofVerified||
    !Number.isSafeInteger(x.sellFinalizedSlot)||x.sellFinalizedSlot<=0||
    !Number.isSafeInteger(x.currentBalanceSlot)||x.currentBalanceSlot<x.sellFinalizedSlot)
  return reject('FINALIZED_CHAIN_PROOF_REQUIRED');
 if(x.sellReceipt.wallet!==x.wallet||x.sellReceipt.mint!==x.mint)
  return reject('SELL_WALLET_OR_MINT_MISMATCH');
 if(x.sellReceipt.confirmed!==true||x.sellReceipt.successful!==true)
  return reject('SELL_NOT_CONFIRMED');
 const receipt=observeEchoReceipt(x.sellReceipt,'SELL');
 if('reason' in receipt)return reject('SELL_'+receipt.reason);
 // Full liquidation only; 50% manual SELL does not free the occupied slot.
 if(x.currentHeldTokenBalanceRaw!=='0')
  return reject('POSITION_REMAINS_OPEN');
 if(receipt.tokenDelta>=0n||receipt.solDelta<=0n)
  return reject('SELL_WALLET_DELTAS_UNVERIFIED');
 return {ok:true,mode:'READ_ONLY_EXIT_PROOF',
  wallet:x.wallet,mint:x.mint,sellSignature:x.sellReceipt.signature,
  soldTokenUnitsRaw:String(-receipt.tokenDelta),
  netWalletSolIncreaseLamports:String(receipt.solDelta),
  safeToRequestDbClose:true,slotReleased:false};
}
