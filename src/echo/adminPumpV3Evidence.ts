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
 /** Optional exact lamport balances for the transaction message accounts. */
 preBalances?:readonly number[];
 postBalances?:readonly number[];
 feeLamports?:number;
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
 // A candidate must never be promoted to verified merely by token receipt.
 // When native balance evidence is supplied, reject malformed or absent payer debit.
 if(e.preBalances!==undefined||e.postBalances!==undefined||e.feeLamports!==undefined){
  const index=e.instruction.accounts.indexOf(e.instruction.callerWallet);
  const pre=e.preBalances?.[index],post=e.postBalances?.[index],fee=e.feeLamports;
  if(index<0||!Number.isSafeInteger(pre)||!Number.isSafeInteger(post)||
     !Number.isSafeInteger(fee)||pre!<0||post!<0||fee!<0||
     e.preBalances?.length!==e.instruction.accounts.length||
     e.postBalances?.length!==e.instruction.accounts.length)
   return deny('INVALID_NATIVE_BALANCE_EVIDENCE');
  if(pre!-post!-fee!<=0)return deny('NO_NATIVE_SOL_PAYMENT_EVIDENCE');
 }
 return {candidate:true,verifiedBuy:false,reason:'PUMP_V3_CANDIDATE_NEEDS_DEBIT_AND_CPI_VERIFICATION',
  receivedTokens:delta[0]!.delta};
}
