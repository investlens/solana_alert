import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createPrivateKey,sign as signEd25519} from 'node:crypto';
import bs58 from 'bs58';
import {Keypair} from '@solana/web3.js';
import {echoReadOnlySignerAdmission,ECHO_SIGNER_TRANSACTION_APPROVAL_ENABLED} from '../src/echo/readOnlySignerAdmission.js';
import {echoSignerCanonicalRequest} from '../src/echo/authenticatedSignerRequest.js';
const coordinator=Keypair.generate();
const privateDer=Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),
 Buffer.from(coordinator.secretKey.slice(0,32))]);
const key=createPrivateKey({key:privateDer,format:'der',type:'pkcs8'});
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint='2'.repeat(44),sol='So11111111111111111111111111111111111111112';
const now=1800000000000,raw=new Uint8Array(120).fill(123);
const hash=createHash('sha256').update(raw).digest('hex');
const request={audience:'echo-isolated-signer' as const,action:'BUY' as const,
 executionWallet:wallet,mint,reservationKey:wallet+':'+mint,transactionSha256:hash,
 nonceHex:'b'.repeat(64),issuedAtMs:now-100,expiresAtMs:now+10000};
const signature=bs58.encode(signEd25519(null,Buffer.from(echoSignerCanonicalRequest(request)),key));
const preview={ok:true as const,reason:'RPC_SIMULATION_SUCCEEDED' as const,
 side:'BUY' as const,inputMint:sol,outputMint:mint,inputRaw:'50000000',
 quotedOutputRaw:'123456',unsignedTransactionSha256:hash,requestId:'test-id',logs:[]};
const row={executionWallet:wallet,mint,state:'reserved',amountLamports:50000000,
 positionClosedAt:null,transactionSignature:null};
test('signed coordinator + nonce + matching DB reservation admits read-only preview, no signer',async()=>{
 const seen=new Set<string>();
 const args={request,coordinatorSignatureBase58:signature,
  coordinatorPublicKey:coordinator.publicKey.toBase58(),nowMs:now,
  unsignedTransactionBytes:raw,nonceStore:{consumeOnce:async(nonce:string)=>{
   if(seen.has(nonce))return false;seen.add(nonce);return true;}},
  reservationReader:{getByWalletAndMint:async()=>row},preview};
 const result=await echoReadOnlySignerAdmission(args);
 assert.deepEqual(result,{ok:true,mode:'PREVIEW_ONLY_NO_SIGNING',fingerprint:hash});
 assert.equal(ECHO_SIGNER_TRANSACTION_APPROVAL_ENABLED,false);
 const repeated=await echoReadOnlySignerAdmission(args);
 assert.deepEqual(repeated,{ok:false,reason:'REPLAYED_REQUEST'});
});
test('forged price/amount, wallet evidence and unknown DB row reject',async()=>{
 const auth=()=>({consumeOnce:async()=>true});
 const args={request,coordinatorSignatureBase58:signature,
 coordinatorPublicKey:coordinator.publicKey.toBase58(),nowMs:now,
 unsignedTransactionBytes:raw,nonceStore:auth(),
 reservationReader:{getByWalletAndMint:async()=>row},preview};
 assert.equal((await echoReadOnlySignerAdmission({...args,preview:{...preview,inputRaw:'1'}})).ok,false);
 assert.equal((await echoReadOnlySignerAdmission({...args,reservationReader:{
  getByWalletAndMint:async()=>null}})).ok,false);
 assert.equal((await echoReadOnlySignerAdmission({...args,preview:{...preview,
  unsignedTransactionSha256:'f'.repeat(64)}})).ok,false);
});
