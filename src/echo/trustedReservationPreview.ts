/** Read-only trusted reservation cross-check before any signer integration.
 * This module is intentionally incapable of signing or broadcasting.
 * Never accept a caller-provided reservation as authority: read it through
 * an authenticated service-role DB adapter isolated from Telegram.
 */
import type {EchoJupiterV2PreviewResult} from './readOnlyJupiterV2Swap.js';
export type EchoTrustedReservation={
 executionWallet:string;mint:string;state:string;amountLamports:number;
 positionClosedAt:string|null;transactionSignature:string|null;
};
export interface EchoTrustedReservationReader {
 getByWalletAndMint(wallet:string,mint:string):Promise<EchoTrustedReservation|null>;
}
export type EchoPreviewAdmission=
 | {ok:true;mode:'READ_ONLY';transactionSha256:string}
 | {ok:false;reason:string};
export async function verifyEchoPreviewAgainstLedger(args:{
 side:'BUY'|'SELL';wallet:string;mint:string;preview:EchoJupiterV2PreviewResult;
 reader:EchoTrustedReservationReader;
}):Promise<EchoPreviewAdmission>{
 if(!args.preview.ok)return {ok:false,reason:'RPC_SIMULATION_NOT_VERIFIED'};
 const p=args.preview;
 if(p.side!==args.side||p.inputRaw==='0'||
    p.unsignedTransactionSha256.length!==64)return {ok:false,reason:'PREVIEW_MISMATCH'};
 let row:EchoTrustedReservation|null;
 try{row=await args.reader.getByWalletAndMint(args.wallet,args.mint);}
 catch{return {ok:false,reason:'RESERVATION_DATABASE_UNAVAILABLE'};}
 if(!row||row.executionWallet!==args.wallet||row.mint!==args.mint)
  return {ok:false,reason:'TRUSTED_RESERVATION_MISSING'};
 if(row.positionClosedAt!==null)return {ok:false,reason:'POSITION_ALREADY_CLOSED'};
 const SOL='So11111111111111111111111111111111111111112';
 if(args.side==='BUY'){
  if(row.state!=='reserved'||p.inputMint!==SOL||p.outputMint!==args.mint||
     !Number.isSafeInteger(row.amountLamports)||
     p.inputRaw!==String(row.amountLamports))
   return {ok:false,reason:'BUY_RESERVATION_MISMATCH'};
 }else{
  if(row.state!=='confirmed'||!row.transactionSignature||
    p.inputMint!==args.mint||p.outputMint!==SOL)
   return {ok:false,reason:'SELL_POSITION_NOT_CHAIN_CONFIRMED'};
  // A verified token balance + owner Telegram intent + dedicated full route
  // inspection are still required. No SELL can be approved for signing here.
  return {ok:false,reason:'SELL_CHAIN_BALANCE_AND_OWNER_PROOF_REQUIRED'};
 }
 return {ok:true,mode:'READ_ONLY',transactionSha256:p.unsignedTransactionSha256};
}
export const ECHO_LEDGER_BACKED_SIGNER_ENABLED=false as const;
