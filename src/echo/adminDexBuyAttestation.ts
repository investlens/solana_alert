/**
 * Conservative Solana DEX BUY evidence validator.
 * Only accepts trusted, already-decoded swap attestations, not raw transfers.
 * The producer must be an independently reviewed parser; untrusted JSON
 * cannot become database authorization evidence.
 */
import { verifyEchoCallerBuyEvidence } from './adminCallerEvidence.js';
export type DexBuyAttestation=Readonly<{
 parserTrusted:boolean; parserVersion:string; rpcTrusted:boolean;
 finalized:boolean; signature:string; callerWallet:string; mint:string;
 verifiedSigner:boolean; swapProgramVerified:boolean;
 exactInputDebited:boolean; exactOutputCredited:boolean;
 routedSwapVerified:boolean; transferOnly:boolean; ageSeconds:number;
}>;
export function verifyEchoDexBuyAttestation(a:DexBuyAttestation):Readonly<{
 verified:boolean;reason:string
}>{
 const deny=(reason:string)=>({verified:false,reason});
 if(!a.parserTrusted||!a.parserVersion)return deny('UNTRUSTED_DEX_PARSER');
 if(!a.swapProgramVerified||!a.exactInputDebited||!a.exactOutputCredited)
  return deny('INCOMPLETE_SWAP_EVIDENCE');
 if(!a.routedSwapVerified)return deny('UNVERIFIED_SWAP_ROUTE');
 return verifyEchoCallerBuyEvidence({
  callerWallet:a.callerWallet,transactionSignature:a.signature,tokenMint:a.mint,
  verifiedSigner:a.verifiedSigner,verifiedSwapBuy:true,finalized:a.finalized,
  rpcTrusted:a.rpcTrusted,transactionAgeSeconds:a.ageSeconds,
  tokenTransferOnly:a.transferOnly,
 });
}
