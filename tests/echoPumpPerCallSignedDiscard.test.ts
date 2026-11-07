import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,ComputeBudgetProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {dryRunEchoPumpActualWalletBuySignedDiscard,
 ECHO_PUMP_DRY_RUN_CAN_BROADCAST,ECHO_PUMP_DRY_RUN_CAN_LIVE_TRADE} from '../src/echo/pumpPerCallSignedDiscard.js';
const pinned='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const synthetic=Keypair.generate();
const bytes=new VersionedTransaction(new TransactionMessage({
 payerKey:synthetic.publicKey,
 recentBlockhash:Keypair.generate().publicKey.toBase58(),
 instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:100000})]
}).compileToV0Message()).serialize();
const sourceSig='2'.repeat(64);
const caller='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
test('synthetic signer is rejected before reservation, evidence or signing',async()=>{
 let signatures=0,dbReads=0,evidenceReads=0,nonceReads=0;
 const res=await dryRunEchoPumpActualWalletBuySignedDiscard({
  signer:{publicWallet:synthetic.publicKey.toBase58(),
   signTransactionMessageForDryRun:async()=>{signatures++;return new Uint8Array(64);}},
  request:{audience:'echo-isolated-signer',action:'BUY',
   executionWallet:pinned,callerWallet:caller,mint:synthetic.publicKey.toBase58(),
   sourceSignature:sourceSig,reservationKey:'test',
   transactionSha256:'a'.repeat(64),nonceHex:'b'.repeat(64),
   issuedAtMs:1800000000000,expiresAtMs:1800000005000},
  ownerAutoBuyEnabled:async()=>false,
  coordinatorSignatureBase58:'synthetic-invalid',
  pinnedCoordinatorPublicKey:synthetic.publicKey.toBase58(),
  nowMs:1800000000100,unsignedTransactionBytes:bytes,
  nonceStore:{consumeOnce:async()=>{nonceReads++;return true;}},
  reservationReader:{getByCall:async()=>{dbReads++;return null;}},
  evidenceReader:{readFromTrustedProviders:async()=>{evidenceReads++;return null;}}
 });
 assert.deepEqual(res,{ok:false,reason:'REAL_PINNED_ECHO_WALLET_NOT_PROVISIONED',
  broadcastAllowed:false});
 assert.equal(signatures,0);
 assert.equal(dbReads,0);
 assert.equal(evidenceReads,0);
 assert.equal(nonceReads,0);
 assert.equal(ECHO_PUMP_DRY_RUN_CAN_BROADCAST,false);
 assert.equal(ECHO_PUMP_DRY_RUN_CAN_LIVE_TRADE,false);
});
test('matching public wallet but unauthenticated request never invokes signer',async()=>{
 let signatures=0;
 const res=await dryRunEchoPumpActualWalletBuySignedDiscard({
  signer:{publicWallet:pinned,
   signTransactionMessageForDryRun:async()=>{signatures++;return new Uint8Array(64);}},
  request:{audience:'echo-isolated-signer',action:'BUY',
   executionWallet:pinned,callerWallet:caller,mint:synthetic.publicKey.toBase58(),
   sourceSignature:sourceSig,reservationKey:'invalid',
   transactionSha256:'a'.repeat(64),nonceHex:'b'.repeat(64),
   issuedAtMs:1800000000000,expiresAtMs:1800000005000},
  ownerAutoBuyEnabled:async()=>false,
  coordinatorSignatureBase58:'invalid',
  pinnedCoordinatorPublicKey:synthetic.publicKey.toBase58(),
  nowMs:1800000000100,unsignedTransactionBytes:bytes,
  nonceStore:{consumeOnce:async()=>true},
  reservationReader:{getByCall:async()=>null},
  evidenceReader:{readFromTrustedProviders:async()=>null}
 });
 assert.equal(res.ok,false);
 assert.equal(res.broadcastAllowed,false);
 assert.equal(signatures,0);
});

test('owner sleep OFF blocks real-wallet signed discard before DB, RPC or key access',async()=>{
 let sign=0,db=0,nonce=0,provider=0;
 const r=await dryRunEchoPumpActualWalletBuySignedDiscard({
  signer:{publicWallet:pinned,
   signTransactionMessageForDryRun:async()=>{sign++;return new Uint8Array(64);}},
  request:{audience:'echo-isolated-signer',action:'BUY',
   executionWallet:pinned,callerWallet:caller,mint:synthetic.publicKey.toBase58(),
   sourceSignature:sourceSig,reservationKey:'not-reached',
   transactionSha256:'a'.repeat(64),nonceHex:'b'.repeat(64),
   issuedAtMs:1800000000000,expiresAtMs:1800000005000},
  ownerAutoBuyEnabled:async()=>false,
  coordinatorSignatureBase58:'not-reached',
  pinnedCoordinatorPublicKey:synthetic.publicKey.toBase58(),
  nowMs:1800000000100,unsignedTransactionBytes:bytes,
  nonceStore:{consumeOnce:async()=>{nonce++;return true;}},
  reservationReader:{getByCall:async()=>{db++;return null;}},
  evidenceReader:{readFromTrustedProviders:async()=>{provider++;return null;}}
 });
 assert.deepEqual(r,{ok:false,reason:'SIGNER_OWNER_AUTO_BUY_OFF',broadcastAllowed:false});
 assert.deepEqual({sign,db,nonce,provider},{sign:0,db:0,nonce:0,provider:0});
});
