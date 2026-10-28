/**
 * Trusted caller source evidence gate for the isolated Echo shadow pilot.
 * This does not assert that a BUY occurred; a trusted indexer must supply
 * independently verified chain data before the caller evidence flag can be set.
 */
export const ECHO_PILOT_CALLERS=Object.freeze([
 '5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',
 'Be24Gbf5KisDk1LcWWZsBn8dvB816By7YzYF5zWZnRR6',
] as const);
export type CallerEvidence=Readonly<{
 callerWallet:string; transactionSignature:string; tokenMint:string;
 verifiedSigner:boolean; verifiedSwapBuy:boolean; finalized:boolean;
 rpcTrusted:boolean; transactionAgeSeconds:number; tokenTransferOnly:boolean;
}>;
export function verifyEchoCallerBuyEvidence(e:CallerEvidence):Readonly<{
 verified:boolean;reason:string
}>{
 const deny=(reason:string)=>({verified:false,reason});
 if(!ECHO_PILOT_CALLERS.some(c=>c===e.callerWallet))return deny('CALLER_NOT_ALLOWED');
 if(!e.transactionSignature||!e.tokenMint||e.transactionSignature.length<32||
    e.tokenMint.length<32)return deny('INVALID_CHAIN_IDENTIFIERS');
 if(!e.verifiedSigner||!e.verifiedSwapBuy||e.tokenTransferOnly)return deny('NOT_VERIFIED_CALLER_BUY');
 if(!e.finalized||!e.rpcTrusted)return deny('UNTRUSTED_OR_UNFINALIZED');
 if(!Number.isFinite(e.transactionAgeSeconds)||e.transactionAgeSeconds<0||
    e.transactionAgeSeconds>60)return deny('STALE_CALLER_EVIDENCE');
 return {verified:true,reason:'VERIFIED_SHADOW_CALLER_BUY'};
}
