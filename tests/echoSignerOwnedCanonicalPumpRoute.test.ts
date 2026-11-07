import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,type AccountInfo} from '@solana/web3.js';
import {discoverEchoCanonicalPumpTwoHop,
 ECHO_CANONICAL_PUMP_ROUTE_CAN_BROADCAST,
 type EchoCanonicalPumpRouteSdk,type EchoCanonicalPumpRouteRpc}
 from '../src/echo/signerOwnedCanonicalPumpRoute.js';
const a=Keypair.generate().publicKey,b=Keypair.generate().publicKey;
const p1=Keypair.generate().publicKey,p2=Keypair.generate().publicKey;
const wsol=new PublicKey('So11111111111111111111111111111111111111112');
const program=new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const wrong=new PublicKey('11111111111111111111111111111111');
const account=(owner=program):AccountInfo<Buffer>=>({
 owner,data:Buffer.alloc(200),executable:false,lamports:10000,rentEpoch:0
});
function sdk(change:{wrongMint?:boolean;mayhem?:boolean}={}):EchoCanonicalPumpRouteSdk{
 return {
  canonicalPumpPoolPda(base,quote){
   if(base.equals(a)&&quote===undefined)return p1;
   if(base.equals(b)&&quote?.equals(a))return p2;
   throw Error('bad canonical lookup');
  },
  decodePool(info){
   if(info===ref1)return {baseMint:a,quoteMint:wsol,isMayhemMode:false};
   return {baseMint:change.wrongMint?a:b,quoteMint:a,
    isMayhemMode:change.mayhem??false};
  }
 };
}
const ref1=account(),ref2=account();
let reads=0;
const rpc=(badOwner=false):EchoCanonicalPumpRouteRpc=>({
 getMultipleAccountsInfoAndContext:async(keys,opts)=>{
  reads++;
  assert.deepEqual(keys.map(x=>x.toBase58()),[p1.toBase58(),p2.toBase58()]);
  assert.equal(opts.commitment,'confirmed');
  return {context:{slot:123},value:[ref1,badOwner?account(wrong):ref2]};
 }
});
const args=(sdkImpl=sdk(),rpcImpl=rpc())=>({
 sdk:sdkImpl,rpc:rpcImpl,intermediateMint:a.toBase58(),
 targetMint:b.toBase58()
});
test('verified official canonical addresses and decoded two-hop pool mints',async()=>{
 const r=await discoverEchoCanonicalPumpTwoHop(args());
 assert.equal(r.ok,true,JSON.stringify(r));
 if(r.ok){
  assert.equal(r.firstPool,p1.toBase58());
  assert.equal(r.secondPool,p2.toBase58());
  assert.equal(r.quoteAndCpiProven,false);
  assert.equal(r.phantomExitProven,false);
  assert.equal(r.canBroadcast,false);
 }
 assert.equal(ECHO_CANONICAL_PUMP_ROUTE_CAN_BROADCAST,false);
});
test('untrusted AMM owner, incorrect mint continuity and Mayhem reject',async()=>{
 for(const input of [args(sdk(),rpc(true)),
  args(sdk({wrongMint:true})),args(sdk({mayhem:true}))]){
  const r=await discoverEchoCanonicalPumpTwoHop(input);
  assert.equal(r.ok,false,JSON.stringify(r));
  assert.equal(r.canSign,false);
 }
});
test('bad or identical token mints fail before RPC and cannot trade',async()=>{
 reads=0;
 for(const candidate of [b.toBase58(),wsol.toBase58(),'bad']){
  const r=await discoverEchoCanonicalPumpTwoHop({
   ...args(),intermediateMint:candidate});
  assert.equal(r.ok,false);
 }
 assert.equal(reads,0);
});
