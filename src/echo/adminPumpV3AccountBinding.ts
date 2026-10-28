/**
 * Strict Pump buy_v3 account binding. This is an additional read-only check,
 * not an authorization or a complete swap decoder.
 * Official Pump IDL buyV3 account indices (zero based):
 * baseMint=1, quoteMint=2, user=8.
 */
import {PUMP_CURVE_PROGRAM} from './adminPumpVenue.js';
import {decodePumpBuyHeader} from './adminPumpBuyHeader.js';
const SOL_MINT='So11111111111111111111111111111111111111112';
export type PumpV3Instruction=Readonly<{
 programId:string; data:Uint8Array; accounts:readonly string[];
 callerWallet:string; targetMint:string; signerAccounts:readonly string[];
}>;
export function inspectPumpV3Buy(i:PumpV3Instruction):Readonly<{
 matched:boolean;reason:string;verifiedBuy:false
}>{
 const deny=(reason:string)=>({matched:false,reason,verifiedBuy:false as const});
 if(i.programId!==PUMP_CURVE_PROGRAM)return deny('WRONG_PROGRAM');
 const decoded=decodePumpBuyHeader(i.programId,i.data);
 if(!decoded||decoded.version!=='buy_v3')return deny('NOT_SUPPORTED_V3_BUY');
 if(i.accounts.length!==17)return deny('UNEXPECTED_ACCOUNT_LAYOUT');
 if(i.accounts[1]!==i.targetMint||i.accounts[2]!==SOL_MINT)
  return deny('MINT_OR_QUOTE_MISMATCH');
 if(i.accounts[8]!==i.callerWallet||!i.signerAccounts.includes(i.callerWallet))
  return deny('CALLER_NOT_SIGNER');
 // Caller trade size is not our execution size. The 0.1 SOL cap belongs\n // to our separate unsigned execution quote and database reservation gate.\n // Rejecting larger caller buys here would silently miss real caller signals.
 return {matched:true,reason:'V3_ENVELOPE_MATCH_ONLY',verifiedBuy:false};
}
