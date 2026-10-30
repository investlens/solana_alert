/** Key-custody handshake for a FUTURE independently operated signer.
 * No key material is accepted or exposed. A signer adapter may be backed by
 * a hardware enclave/secure key store. This module must not run in the alert worker.
 * Signing of Solana transactions is deliberately NOT exposed by this interface.
 */
import {randomBytes} from 'node:crypto';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {verifyEchoWalletChallengeSignature, type EchoWalletChallenge} from './walletOwnershipProof.js';
export interface EchoCustodyProofProvider {
 readonly publicWallet:string;
 /** Off-chain message only. Not a Solana transaction signature. */
 signOwnershipMessage(message:Uint8Array):Promise<Uint8Array>;
}
export type EchoCustodyProbeResult=
 | {verified:true;wallet:string}
 | {verified:false;reason:string};
export async function probeEchoSignerCustody(args:{
 provider:EchoCustodyProofProvider; expectedWallet:string;
 audience:string;nowMs:number;
}):Promise<EchoCustodyProbeResult> {
 const {provider,expectedWallet,nowMs,audience}=args;
 try{
  if(!Number.isSafeInteger(nowMs)||nowMs<=0||
     !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(audience)||
     new PublicKey(provider.publicWallet).toBase58()!==new PublicKey(expectedWallet).toBase58())
   return {verified:false,reason:'SIGNER_IDENTITY_MISMATCH'};
  const challenge:EchoWalletChallenge={
   wallet:expectedWallet,audience,nonceHex:randomBytes(32).toString('hex'),
   issuedAtMs:nowMs,expiresAtMs:nowMs+30_000
  };
  const {makeEchoWalletOwnershipMessage}=await import('./walletOwnershipProof.js');
  const bytes=new TextEncoder().encode(makeEchoWalletOwnershipMessage(challenge));
  const signature=await provider.signOwnershipMessage(bytes);
  if(signature.length!==64||!verifyEchoWalletChallengeSignature(challenge,bs58.encode(signature)))
   return {verified:false,reason:'SIGNATURE_PROOF_FAILED'};
  return {verified:true,wallet:expectedWallet};
 }catch{return {verified:false,reason:'SIGNER_UNAVAILABLE'};}
}
/** Even successful key custody proof never enables live transaction signing. */
export const ECHO_SIGNER_TRANSACTION_SIGNING_ENABLED=false as const;
