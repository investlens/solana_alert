/**
 * Pump-specific conservative decoded instruction boundary.
 * Explicitly supports a limited legacy Pump buy layout only.
 * Newer v2/v3 and PumpSwap instructions require version-specific SDK/IDL
 * decoding; unknown variants are denied, not guessed.
 */
import { PUMP_CURVE_PROGRAM } from './adminPumpVenue.js';
export type PumpDecodedInstruction=Readonly<{
 programId:string; instructionName:string; accounts:readonly string[];
 signerWallet:string; mint:string; maxQuoteLamports:bigint;
 baseTokens:bigint; finalized:boolean; rpcTrusted:boolean;
}>;
export function validatePumpLegacyBuyInstruction(i:PumpDecodedInstruction):Readonly<{
 valid:boolean;reason:string
}>{
 const deny=(reason:string)=>({valid:false,reason});
 if(i.programId!==PUMP_CURVE_PROGRAM)return deny('UNSUPPORTED_PUMP_PROGRAM');
 if(i.instructionName!=='buy')return deny('UNSUPPORTED_PUMP_INSTRUCTION_VERSION');
 if(!i.finalized||!i.rpcTrusted)return deny('UNTRUSTED_CHAIN_EVIDENCE');
 if(i.signerWallet.length<32||i.mint.length<32)return deny('INVALID_ACCOUNT');
 if(!i.accounts.includes(i.signerWallet)||!i.accounts.includes(i.mint))
  return deny('ACCOUNT_MISMATCH');
 if(i.baseTokens<=0n||i.maxQuoteLamports<=0n)return deny('INVALID_BUY_AMOUNTS');
 // This only validates a decoded instruction envelope, not its source,
 // discriminator, account ordering, actual debit, or trade route.
 return {valid:true,reason:'LEGACY_INSTRUCTION_ENVELOPE_ONLY'};
}
