import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createPrivateKey,sign as ed25519Sign} from 'node:crypto';
import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import {authenticateEchoSignerRequest,echoSignerCanonicalRequest,
 type EchoNonceStore,ECHO_AUTHENTICATED_SIGNING_ENABLED} from '../src/echo/authenticatedSignerRequest.js';
const coordinator=Keypair.generate();
const bytes=Buffer.alloc(120,37);
const now=1800000000000;
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint='So11111111111111111111111111111111111111112';
const request={audience:'echo-isolated-signer' as const,action:'BUY' as const,
 executionWallet:wallet,mint,reservationKey:wallet+':'+mint,
 transactionSha256:createHash('sha256').update(bytes).digest('hex'),
 nonceHex:'a'.repeat(64),issuedAtMs:now-1000,expiresAtMs:now+10000};
const privateDer=Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(coordinator.secretKey.slice(0,32))]);
const key=createPrivateKey({key:privateDer,format:'der',type:'pkcs8'});
const sign=(r:typeof request)=>bs58.encode(ed25519Sign(null,Buffer.from(echoSignerCanonicalRequest(r)),key));
function testNonceStore(){
 const used=new Set<string>();
 return {store:{async consumeOnce(nonce:string){if(used.has(nonce))return false;used.add(nonce);return true;}} as EchoNonceStore,used};
}
const identity=coordinator.publicKey.toBase58();
test('valid service identity signature and nonce permits only authorization boundary',async()=>{
 const {store}=testNonceStore();
 const args={request,signatureBase58:sign(request),authorizedCoordinatorPublicKey:identity,
  nowMs:now,unsignedTransactionBytes:bytes,nonceStore:store};
 assert.deepEqual(await authenticateEchoSignerRequest(args),{ok:true});
 assert.deepEqual(await authenticateEchoSignerRequest(args),{ok:false,reason:'REPLAYED_REQUEST'});
 assert.equal(ECHO_AUTHENTICATED_SIGNING_ENABLED,false);
});
test('tamper, stale, wrong signer, transaction mismatch, storage failure all fail closed',async()=>{
 const {store}=testNonceStore();
 const args={request,signatureBase58:sign(request),authorizedCoordinatorPublicKey:identity,
 nowMs:now,unsignedTransactionBytes:bytes,nonceStore:store};
 assert.equal((await authenticateEchoSignerRequest({...args,request:{...request,action:'SELL'}})).ok,false);
 assert.equal((await authenticateEchoSignerRequest({...args,nowMs:now+20000})).ok,false);
 assert.equal((await authenticateEchoSignerRequest({...args,unsignedTransactionBytes:Buffer.alloc(120,36)})).ok,false);
 assert.equal((await authenticateEchoSignerRequest({...args,authorizedCoordinatorPublicKey:Keypair.generate().publicKey.toBase58()})).ok,false);
 const outage:EchoNonceStore={consumeOnce:async()=>{throw Error('offline')}};
 assert.deepEqual(await authenticateEchoSignerRequest({...args,nonceStore:outage}),
  {ok:false,reason:'NONCE_STORAGE_UNAVAILABLE'});
});
