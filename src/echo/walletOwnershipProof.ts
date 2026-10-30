/** Cryptographic proof of control for the dedicated Echo wallet.
 * Verification only: never accepts or stores a secret key.
 * Issuance and single-use consumption MUST be persisted by the privileged
 * signer, not by the Telegram bot or the caller invoking this function.
 */
import {createPublicKey,verify as ed25519Verify} from 'node:crypto';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {ECHO_EXPECTED_EXECUTION_WALLET} from './executionWallet.js';
export const ECHO_WALLET_CHALLENGE_DOMAIN='AlphaOS-Echo/wallet-ownership/v1';
export type EchoWalletChallenge={
 wallet:string;nonceHex:string;issuedAtMs:number;expiresAtMs:number;audience:string
};
const digest=/^[0-9a-f]{64}$/;
export function makeEchoWalletOwnershipMessage(v:EchoWalletChallenge):string{
 return [ECHO_WALLET_CHALLENGE_DOMAIN,'wallet='+v.wallet,'audience='+v.audience,
 'nonce='+v.nonceHex,'issued='+v.issuedAtMs,'expires='+v.expiresAtMs].join('\n');
}
export function verifyEchoWalletOwnershipProof(args:{
 challenge:EchoWalletChallenge;signatureBase58:string;
 nowMs:number;expectedAudience:string;nonceAlreadyConsumed:boolean;
}):boolean{
 const {challenge,signatureBase58,nowMs,expectedAudience,nonceAlreadyConsumed}=args;
 if(nonceAlreadyConsumed||!digest.test(challenge.nonceHex)||
  challenge.wallet!==ECHO_EXPECTED_EXECUTION_WALLET||
  challenge.audience!==expectedAudience||!/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(expectedAudience)||
  !Number.isSafeInteger(nowMs)||!Number.isSafeInteger(challenge.issuedAtMs)||
  !Number.isSafeInteger(challenge.expiresAtMs)||challenge.issuedAtMs>nowMs||
  challenge.expiresAtMs<nowMs||challenge.expiresAtMs-challenge.issuedAtMs>120000||
  challenge.expiresAtMs<=challenge.issuedAtMs)return false;
 try{
  const signature=bs58.decode(signatureBase58);
  if(signature.length!==64)return false;
  const publicRaw=new PublicKey(challenge.wallet).toBytes();
  // RFC 8410 DER SPKI wrapping a 32-byte Ed25519 public key.
  const der=Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(publicRaw)]);
  return ed25519Verify(null,Buffer.from(makeEchoWalletOwnershipMessage(challenge),'utf8'),
    createPublicKey({key:der,format:'der',type:'spki'}),signature);
 }catch{return false;}
}
