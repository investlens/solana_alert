/** Isolated proof-only Ed25519 adapter for a dedicated low-balance wallet.
 *
 * Private material is read ONLY from this isolated process's secure sealed
 * environment variable. NEVER import a key from the legacy bot, accept key
 * material through an HTTP request, expose it to Telegram, or return signed
 * bytes to a caller. This adapter cannot sign Solana transactions.
 */
import {createPrivateKey,sign as signEd25519} from 'node:crypto';
import bs58 from 'bs58';
import {Keypair} from '@solana/web3.js';
import {ECHO_WALLET_CHALLENGE_DOMAIN,makeEchoWalletOwnershipMessage,
 type EchoWalletChallenge} from './walletOwnershipProof.js';
import {ECHO_EXPECTED_EXECUTION_WALLET} from './executionWallet.js';
import type {EchoCustodyProofProvider} from './isolatedCustodyProbe.js';

export const ECHO_SEALED_CUSTODY_TRANSACTION_SIGNING_ENABLED=false as const;
export type EchoSealedCustodyResult=
 | {ok:true;provider:EchoCustodyProofProvider;transactionSigningAllowed:false}
 | {ok:false;reason:string;transactionSigningAllowed:false};

const isChallenge=(bytes:Uint8Array,wallet:string,now:number)=>{
 try{
  if(bytes.length<100||bytes.length>500)return false;
  const text=Buffer.from(bytes).toString('utf8');
  const parts=text.split('\n');
  if(parts.length!==6||parts[0]!==ECHO_WALLET_CHALLENGE_DOMAIN)return false;
  const challenge:EchoWalletChallenge={
   wallet:parts[1]?.slice(7),audience:parts[2]?.slice(9),
   nonceHex:parts[3]?.slice(6),
   issuedAtMs:Number(parts[4]?.slice(7)),
   expiresAtMs:Number(parts[5]?.slice(8))
  };
  if(!parts[1]?.startsWith('wallet=')||
     !parts[2]?.startsWith('audience=')||
     !parts[3]?.startsWith('nonce=')||
     !parts[4]?.startsWith('issued=')||
     !parts[5]?.startsWith('expires=')||
     challenge.wallet!==wallet||challenge.audience!=='echo-isolated-signer'||
     !/^[0-9a-f]{64}$/.test(challenge.nonceHex)||
     !Number.isSafeInteger(challenge.issuedAtMs)||
     !Number.isSafeInteger(challenge.expiresAtMs)||
     challenge.issuedAtMs>now||now-challenge.issuedAtMs>30_000||
     now>challenge.expiresAtMs||
     challenge.expiresAtMs-challenge.issuedAtMs>30_000||
     challenge.expiresAtMs<=challenge.issuedAtMs)
    return false;
  return makeEchoWalletOwnershipMessage(challenge)===text;
 }catch{return false;}
};

export function createEchoSealedCustodyProofOnly(args:{
 secretBase58?:string;expectedWallet:string;mode:string|undefined;
 broadcastEnabled:string|undefined;requestsEnabled:string|undefined;
 clock?:()=>number;
}):EchoSealedCustodyResult{
 const stop=(reason:string):EchoSealedCustodyResult=>({
  ok:false,reason,transactionSigningAllowed:false});
 if(args.mode!=='PROOF_ONLY'||args.broadcastEnabled!=='false'||
    args.requestsEnabled!=='false')return stop('PROOF_ONLY_GUARD_REQUIRED');
 if(!args.secretBase58||args.secretBase58.length>256)
  return stop('SEALED_SIGNER_KEY_UNAVAILABLE');
 try{
  const secret=bs58.decode(args.secretBase58);
  if(secret.length!==64){secret.fill(0);return stop('INVALID_SEALED_KEY');}
  const wallet=Keypair.fromSecretKey(secret);
  secret.fill(0);
  if(wallet.publicKey.toBase58()!==args.expectedWallet){
   wallet.secretKey.fill(0);return stop('SEALED_SIGNER_WALLET_MISMATCH');
  }
  const der=Buffer.concat([
   Buffer.from('302e020100300506032b657004220420','hex'),
   Buffer.from(wallet.secretKey.slice(0,32))
  ]);
  const key=createPrivateKey({key:der,format:'der',type:'pkcs8'});
  der.fill(0);wallet.secretKey.fill(0);
  const clock=args.clock??Date.now;
  return {ok:true,transactionSigningAllowed:false,provider:{
   publicWallet:args.expectedWallet,
   signOwnershipMessage:async(bytes:Uint8Array)=>{
    if(!isChallenge(bytes,args.expectedWallet,clock()))
     throw Error('OFFCHAIN_WALLET_CHALLENGE_ONLY');
    return new Uint8Array(signEd25519(null,Buffer.from(bytes),key));
   }
  }};
 }catch{return stop('SEALED_SIGNER_KEY_UNAVAILABLE');}
}

/** Safe operational entrypoint for a sealed variable installed through the
 * Railway UI, never passed via connector or shown in shell logs.
 */
export async function proveEchoPinnedSealedCustodyFromEnv(
 env:Record<string,string|undefined>,nowMs=Date.now()
):Promise<'VERIFIED'|'MISMATCH'|'UNPROVISIONED'>{
 const expected=env.ECHO_SIGNER_EXPECTED_WALLET;
 if(expected!==ECHO_EXPECTED_EXECUTION_WALLET)return 'MISMATCH';
 const result=createEchoSealedCustodyProofOnly({
  secretBase58:env.ECHO_ISOLATED_SIGNER_SECRET_B58,
  expectedWallet:expected,mode:env.ECHO_SIGNER_MODE,
  broadcastEnabled:env.ECHO_SIGNER_BROADCAST_ENABLED,
  requestsEnabled:env.ECHO_SIGNER_REQUESTS_ENABLED,
  clock:()=>nowMs
 });
 if(!result.ok)return 'reason' in result&&result.reason==='SEALED_SIGNER_WALLET_MISMATCH'?
  'MISMATCH':'UNPROVISIONED';
 const {verifyEchoConfiguredWalletCustody}=await import('./configuredCustodyProof.js');
 const proof=await verifyEchoConfiguredWalletCustody(result.provider,nowMs);
 return proof.verified?'VERIFIED':'UNPROVISIONED';
}
