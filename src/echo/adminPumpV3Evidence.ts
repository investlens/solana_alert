/**
 * Pump buy_v3 evidence inspection, shadow-only.
 * Combines decoded instruction, signer binding, finalized transaction result,
 * and exact token balance deltas. Not sufficient for trade authorization:
 * full IDL, native SOL debit and inner CPI/event verification are pending.
 */
import {inspectPumpV3Buy,type PumpV3Instruction} from './adminPumpV3AccountBinding.js';
import {extractCallerTokenDeltas,type ParsedTokenBalance} from './adminParsedTokenDeltas.js';
export type PumpV3Evidence=Readonly<{
 instruction:PumpV3Instruction;
 preTokenBalances:readonly ParsedTokenBalance[];
 postTokenBalances:readonly ParsedTokenBalance[];
 finalized:boolean;
 transactionSucceeded:boolean;
 trustedRpc:boolean;
}>;
export function inspectPumpV3Evidence(e:PumpV3Evidence):Readonly<{
 candidate:boolean;verifiedBuy:false;reason:string;receivedTokens:bigint
}>{
 const deny=(reason:string)=>({candidate:false,verifiedBuy:false as const,reason,receivedTokens:0n});
 if(!e.finalized||!e.transactionSucceeded||!e.trustedRpc)
  return deny('UNVERIFIED_TRANSACTION_RESULT');
 const instruction=inspectPumpV3Buy(e.instruction);
 if(!instruction.matched)return deny(instruction.reason);
 const balances=extractCallerTokenDeltas(
  e.preTokenBalances,e.postTokenBalances,e.instruction.callerWallet);
 if(!balances.valid)return deny(balances.reason);
 const delta=balances.deltas.filter(d=>d.mint===e.instruction.targetMint);
 if(delta.length!==1||delta[0]!.delta<=0n)return deny('NO_UNAMBIGUOUS_TOKEN_RECEIPT');
 return {candidate:true,verifiedBuy:false,reason:'PUMP_V3_CANDIDATE_NEEDS_DEBIT_AND_CPI_VERIFICATION',
  receivedTokens:delta[0]!.delta};
}
