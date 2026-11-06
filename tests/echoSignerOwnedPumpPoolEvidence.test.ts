import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair,PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction}
 from '@solana/web3.js';
import {inspectSignerOwnedPumpPoolEvidence,
 PUMP_SWAP_PROGRAM_ID,ECHO_SIGNER_POOL_PROVENANCE_CAN_BROADCAST,
 type EchoSignerPoolRpc} from '../src/echo/signerOwnedPumpPoolEvidence.js';
const wallet=new PublicKey('8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ');
const pool=Keypair.generate().publicKey;
const mint=Keypair.generate().publicKey;
const token=new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const program=new PublicKey(PUMP_SWAP_PROGRAM_ID);
const tx=new VersionedTransaction(new TransactionMessage({
 payerKey:wallet,recentBlockhash:Keypair.generate().publicKey.toBase58(),
 instructions:[new TransactionInstruction({programId:program,
  keys:[{pubkey:pool,isSigner:false,isWritable:true},
        {pubkey:mint,isSigner:false,isWritable:false}],data:Buffer.from([1])})]
}).compileToV0Message()).serialize();
const sha=createHash('sha256').update(tx).digest('hex');
const mintData=Buffer.alloc(82);mintData[44]=6;
let rpcReads=0;
function rpc(overrides:{poolOwner?:PublicKey;mintOwner?:PublicKey;
  slot?:number;missingPool?:boolean;missingMint?:boolean;balance?:number}={}):EchoSignerPoolRpc{
 return {
  async getMultipleAccountsInfoAndContext(keys,config){
   rpcReads++;
   assert.equal(config.minContextSlot,1);
   assert.deepEqual(keys.map(k=>k.toBase58()),[pool.toBase58(),mint.toBase58()]);
   return {context:{slot:overrides.slot??100},
    value:[
     overrides.missingPool?null:{owner:overrides.poolOwner??program,
      executable:false,data:Buffer.alloc(200)},
     overrides.missingMint?null:{owner:overrides.mintOwner??token,
      executable:false,data:mintData}
    ]};
  },
  async getBalanceAndContext(){return {context:{slot:100},value:overrides.balance??0};},
  async getFeeForMessage(){return {context:{slot:100},value:5000};},
  async isBlockhashValid(){return {context:{slot:100},value:true};},
  async simulateTransaction(){throw Error('unfunded must not simulate');}
 };
}
const input=(connection:EchoSignerPoolRpc)=>({
 connection,unsignedBytes:tx,expectedUnsignedSha256:sha,
 targetMint:mint.toBase58(),sdkDerivedPools:[pool.toBase58()],
 nowMs:1800000000000
});
test('actual pool/mint owner reads are diagnostic only, never sign authority',async()=>{
 rpcReads=0;
 const result=await inspectSignerOwnedPumpPoolEvidence(input(rpc()));
 assert.equal(result.ok,true,JSON.stringify(result));
 if(result.ok){
  assert.equal(result.targetDecimals,6);
  assert.equal(result.poolMintContinuityProven,false);
  assert.equal(result.completeCpiEconomicsProven,false);
  assert.equal(result.phantomSellReserveProven,false);
  assert.equal(result.simulatedWalletProbe.ok,false);
  assert.equal(result.canSign,false);
  assert.equal(result.canBroadcast,false);
 }
 assert.equal(rpcReads,1);
 assert.equal(ECHO_SIGNER_POOL_PROVENANCE_CAN_BROADCAST,false);
});
test('tampered bytes or a pool not in exact signed instructions cause zero RPC reads',async()=>{
 rpcReads=0;
 const copied=Uint8Array.from(tx);copied[copied.length-1]^=1;
 const cases=[
  {...input(rpc()),unsignedBytes:copied},
  {...input(rpc()),sdkDerivedPools:[Keypair.generate().publicKey.toBase58()]},
  {...input(rpc()),targetMint:Keypair.generate().publicKey.toBase58()}
 ];
 for(const c of cases){
  const result=await inspectSignerOwnedPumpPoolEvidence(c);
  assert.equal(result.ok,false,JSON.stringify(result));
 }
 assert.equal(rpcReads,0);
});
test('wrong program owner, wrong mint owner, missing RPC accounts and stale slot reject',async()=>{
 for(const changed of [
  {poolOwner:token},{mintOwner:program},{missingPool:true},{missingMint:true},
  {slot:0}
 ]){
  const result=await inspectSignerOwnedPumpPoolEvidence(input(rpc(changed)));
  assert.equal(result.ok,false,JSON.stringify(changed));
  assert.equal(result.canBroadcast,false);
 }
});
