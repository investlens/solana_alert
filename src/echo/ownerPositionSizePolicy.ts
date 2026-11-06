/** Echo phase-one position sizing, READ-ONLY policy.
 * No Telegram/caller payload may alter the configured tier. After proving the
 * first funded/manual-exit trade, a trusted owner-only configuration workflow
 * may propose 0.1 or 0.2 SOL, but each tier MUST require fresh explicit
 * authorization and revised risk limits. The existing $10 all-in/$30 lifetime
 * caps remain in force. The signer must independently recheck before signing.
 */
export const ECHO_INITIAL_BUY_SOL = '0.025' as const;
export const ECHO_INITIAL_BUY_LAMPORTS = 25_000_000n;
export const ECHO_SIZE_OPTIONS_SOL = ['0.025','0.1','0.2'] as const;
export type EchoPositionSize = typeof ECHO_SIZE_OPTIONS_SOL[number];
export const ECHO_SIZE_EXECUTION_ENABLED = false as const;
export const ECHO_INITIAL_ALL_IN_CAP_CENTS = 1000n;
export const ECHO_INITIAL_LIFETIME_CAP_CENTS = 3000n;
export type EchoSizingPolicy = {
 requestedSol:EchoPositionSize;
 /** Owner-approved size, stored server-side; never from a Telegram callback. */
 approvedSol:EchoPositionSize;
 /** A later tier is only valid with separate audited, revocable approval. */
 explicitTierApproval:boolean;
 /** Real finalized first BUY and independent verified full manual sell. */
 firstTradeAndManualExitVerified:boolean;
 /** Trusted independently quoted USD conversion; integer cents per SOL. */
 solUsdCentsPerSol:number;
 /** Maximum all incremental BUY costs, in whole cents. */
 estimatedFeeAndOtherCostsCents:string;
 /** Owner lifetime spend already committed, including closed trades. */
 cumulativeCommittedCents:string;
 /** Wallet balance and fees are checked independently elsewhere. */
};
export type EchoSizingResult =
 | {eligible:true; executable:false; lamports:string; principalCents:string; allInCents:string; reason:'PREVIEW_ONLY'}
 | {eligible:false; executable:false;reason:string};
const intCents=(s:string):bigint|null=>typeof s==='string'&&/^(0|[1-9][0-9]{0,12})$/.test(s)?BigInt(s):null;
const lamports:Record<EchoPositionSize,bigint>={
 '0.025':25_000_000n,'0.1':100_000_000n,'0.2':200_000_000n
};
export function previewEchoOwnerPositionSize(input:EchoSizingPolicy):EchoSizingResult{
 const stop=(reason:string):EchoSizingResult=>({eligible:false,executable:false,reason});
 if(!(input.requestedSol in lamports)||!(input.approvedSol in lamports))return stop('INVALID_SIZE');
 if(input.requestedSol!==input.approvedSol)return stop('OWNER_APPROVED_SIZE_MISMATCH');
 if(input.requestedSol!=='0.025'&&
    (!input.explicitTierApproval||!input.firstTradeAndManualExitVerified))
   return stop('SIZE_UPGRADE_NOT_APPROVED_OR_VALIDATED');
 if(!Number.isSafeInteger(input.solUsdCentsPerSol)||input.solUsdCentsPerSol<=0||
    input.solUsdCentsPerSol>10_000_000)
   return stop('UNVERIFIED_SOL_USD');
 const costs=intCents(input.estimatedFeeAndOtherCostsCents);
 const committed=intCents(input.cumulativeCommittedCents);
 if(costs===null||costs<=0n||committed===null)
   return stop('UNVERIFIED_FEES_OR_LEDGER');
 const amount=lamports[input.requestedSol];
 // Round UP the principal to the nearest cent: conservative USD budget.
 const principal=(amount*BigInt(input.solUsdCentsPerSol)+999_999_999n)/1_000_000_000n;
 const allIn=principal+costs;
 if(allIn>ECHO_INITIAL_ALL_IN_CAP_CENTS)
   return stop('EXCEEDS_INITIAL_TEN_DOLLAR_ALL_IN_CAP');
 if(committed+allIn>ECHO_INITIAL_LIFETIME_CAP_CENTS)
   return stop('EXCEEDS_INITIAL_THIRTY_DOLLAR_LIFETIME_CAP');
 return {eligible:true,executable:false,lamports:String(amount),
  principalCents:String(principal),allInCents:String(allIn),
  reason:'PREVIEW_ONLY'};
}
