import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createPrivateKey,sign as signEd25519} from 'node:crypto';
import bs58 from 'bs58';
import {Keypair,PublicKey,ComputeBudgetProgram,TransactionMessage,TransactionInstruction,VersionedTransaction} from '@solana/web3.js';
import {admitEchoPerCallSignerV2,canonicalEchoPerCallSignerRequest,perCallKey,
 ECHO_PER_CALL_SIGNER_V2_SIGNING_ENABLED,ECHO_PER_CALL_SIGNER_V2_BROADCAST_ENABLED,
 type EchoPerCallSignerRequest,type EchoPerCallReservation} from '../src/echo/perCallSignerAdmissionV2.js';
import {auditEchoUnsignedSwap} from '../src/echo/unsignedSwapAudit.js';
import {SLINGOOR_WALLET} from '../src/echo/liveBuyPolicy.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const caller=SLINGOOR_WALLET,mint='2'.repeat(44),source='3'.repeat(64),now=1800000000000;
const coordinator=Keypair.generate();
const privateDer=Buffer.concat([
 Buffer.from('302e020100300506032b657004220420','hex'),
 Buffer.from(coordinator.secretKey.slice(0,32))
]);
const key=createPrivateKey({key:privateDer,format:'der',type:'pkcs8'});
const inputRaw='20000000';
const bytes=new VersionedTransaction(new TransactionMessage({
 payerKey:new PublicKey(wallet),
 recentBlockhash:Keypair.generate().publicKey.toBase58(),
 instructions:[
  ComputeBudgetProgram.setComputeUnitLimit({units:100000}),
  ComputeBudgetProgram.setComputeUnitPrice({microLamports:10000}),
  new TransactionInstruction({
   programId:new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'),
   keys:[],data:Buffer.from([1])})
 ]
}).compileToV0Message()).serialize();
const audit=auditEchoUnsignedSwap(Buffer.from(bytes).toString('base64'),wallet);
if(!audit.ok)throw Error('test unsigned audit missing');
const hash=createHash('sha256').update(bytes).digest('hex');
const base={
 audience:'echo-isolated-signer' as const,action:'BUY' as const,
 executionWallet:wallet,callerWallet:caller,mint,sourceSignature:source,
 transactionSha256:hash,nonceHex:'a'.repeat(64),issuedAtMs:now-100,
 expiresAtMs:now+10000
};
const request:EchoPerCallSignerRequest={...base,reservationKey:perCallKey(base)};
const row:EchoPerCallReservation={
 executionWallet:wallet,callerWallet:caller,mint,sourceSignature:source,
 state:'reserved',amountLamports:20000000,allInCents:443,
 positionClosedAt:null,transactionSignature:null
};
const preview={
 ok:true as const,reason:'RPC_SIMULATION_SUCCEEDED' as const,side:'BUY' as const,
 inputMint:'So11111111111111111111111111111111111111112',outputMint:mint,
 inputRaw,quotedOutputRaw:'12345',unsignedTransactionSha256:hash,
 requestId:'synthetic-preview',logs:[],unitsConsumed:80000,unsignedAudit:audit.audit
};
const signed=(r:EchoPerCallSignerRequest)=>
 bs58.encode(signEd25519(null,Buffer.from(canonicalEchoPerCallSignerRequest(r)),key));
const args=()=>({
 request,signatureBase58:signed(request),
 pinnedCoordinatorPublicKey:coordinator.publicKey.toBase58(),nowMs:now,
 unsignedTransactionBytes:bytes,
 nonceStore:{consumeOnce:async()=>true},
 reader:{getByCall:async()=>row},preview
});
test('distinct source call authenticates through pinned coordinator and DB, never signs',async()=>{
 const nonces=new Set<string>();
 const p=args();
 p.nonceStore.consumeOnce=async(nonce:string)=>{
  if(nonces.has(nonce))return false;nonces.add(nonce);return true;
 };
 const ok=await admitEchoPerCallSignerV2(p);
 assert.deepEqual(ok,{ok:true,mode:'PER_CALL_PREVIEW_ONLY',
  fingerprint:hash,signingAllowed:false});
 assert.deepEqual(await admitEchoPerCallSignerV2(p),
  {ok:false,reason:'PER_CALL_NONCE_REPLAYED',signingAllowed:false});
 assert.equal(ECHO_PER_CALL_SIGNER_V2_SIGNING_ENABLED,false);
 assert.equal(ECHO_PER_CALL_SIGNER_V2_BROADCAST_ENABLED,false);
});
test('mutating source signature, token, mint, or transaction breaks authentication',async()=>{
 const cases=[
  {sourceSignature:'4'.repeat(64)},
  {callerWallet:Keypair.generate().publicKey.toBase58()},
  {mint:'5'.repeat(44)},
  {transactionSha256:'f'.repeat(64)},
  {reservationKey:wallet+':'+mint}
 ];
 for(const change of cases){
  const bad={...request,...change};
  const admission=await admitEchoPerCallSignerV2({...args(),request:bad});
  assert.equal(admission.ok,false,JSON.stringify(change));
 }
});
test('wrong DB lot, exact fee, amount or missing simulation rejects without nonce',async()=>{
 let consumed=0;
 for(const changed of [
  {reader:{getByCall:async()=>({...row,sourceSignature:'4'.repeat(64)})}},
  {reader:{getByCall:async()=>({...row,allInCents:501})}},
  {reader:{getByCall:async()=>({...row,amountLamports:30000000})}},
  {preview:{...preview,inputRaw:'30000000'}},
  {preview:{...preview,ok:false as const,reason:'NOT_SIMULATED' as const}}
 ]){
  const val=await admitEchoPerCallSignerV2({
   ...args(),...changed,
   nonceStore:{consumeOnce:async()=>{consumed++;return true;}}
  });
  assert.equal(val.ok,false);
 }
 assert.equal(consumed,0);
});
