/** Cryptographic signed-message attestation for future one-shot Echo submission.
 * No private key access, quote, signer approval, submission or retries here.
 * The isolated signer must bind the approved unsigned Solana message hash and
 * authorized fee payer BEFORE returning a signed transaction to coordinator.
 */
import {createHash,createPublicKey,verify as verifyEd25519} from 'node:crypto';
import {PublicKey,VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';

export type EchoVerifiedSignedMessage =
 | {ok:true;messageSha256:string;signature:string;feePayer:string;broadcastAllowed:false}
 | {ok:false;reason:string;broadcastAllowed:false};
const sha=/^[a-f0-9]{64}$/;
export function verifyEchoSignedMessage(args:{
 signedTransactionBase64:string;approvedMessageSha256:string;expectedFeePayer:string;
}):EchoVerifiedSignedMessage{
 const deny=(reason:string):EchoVerifiedSignedMessage=>({
  ok:false,reason,broadcastAllowed:false});
 if(!sha.test(args.approvedMessageSha256))return deny('INVALID_APPROVED_MESSAGE_HASH');
 let wallet:PublicKey,bytes:Buffer,tx:VersionedTransaction;
 try{
  wallet=new PublicKey(args.expectedFeePayer);
  if(wallet.toBase58()!==args.expectedFeePayer||!PublicKey.isOnCurve(wallet.toBytes()))
   return deny('INVALID_FEE_PAYER');
  if(typeof args.signedTransactionBase64!=='string'||args.signedTransactionBase64.length>4096||
     args.signedTransactionBase64.length<120||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(args.signedTransactionBase64))
   return deny('INVALID_SIGNED_TRANSACTION');
  bytes=Buffer.from(args.signedTransactionBase64,'base64');
  if(bytes.toString('base64')!==args.signedTransactionBase64)
   return deny('INVALID_SIGNED_TRANSACTION');
  tx=VersionedTransaction.deserialize(bytes);
 }catch{return deny('INVALID_SIGNED_TRANSACTION');}
 if(tx.message.version!==0||tx.message.addressTableLookups.length!==0||
    tx.message.header.numRequiredSignatures!==1||tx.signatures.length!==1||
    tx.message.staticAccountKeys[0]?.toBase58()!==args.expectedFeePayer)
  return deny('UNTRUSTED_SIGNER_OR_MESSAGE');
 const serializedMessage=Buffer.from(tx.message.serialize());
 const digest=createHash('sha256').update(serializedMessage).digest('hex');
 if(digest!==args.approvedMessageSha256)return deny('APPROVED_MESSAGE_MISMATCH');
 const signature=tx.signatures[0];
 if(signature.length!==64||signature.every(x=>x===0))return deny('MISSING_SIGNATURE');
 try{
  const der=Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),
   Buffer.from(wallet.toBytes())]);
  if(!verifyEd25519(null,serializedMessage,
   createPublicKey({key:der,format:'der',type:'spki'}),Buffer.from(signature)))
   return deny('SIGNATURE_CRYPTOGRAPHICALLY_INVALID');
 }catch{return deny('SIGNATURE_CRYPTOGRAPHICALLY_INVALID');}
 return {ok:true,messageSha256:digest,signature:bs58.encode(signature),
  feePayer:args.expectedFeePayer,broadcastAllowed:false};
}
