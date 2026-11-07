import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair,PublicKey,TransactionInstruction,TransactionMessage,
 VersionedTransaction,SystemProgram,type AccountInfo} from '@solana/web3.js';
import {inspectSignerOwnedOfficialPumpQuote,
 ECHO_OFFICIAL_PUMP_QUOTE_CAN_BROADCAST,
 type EchoOfficialPumpSdkAdapter,type EchoOfficialPumpQuoteRpc}
 from '../src/echo/signerOwnedOfficialPumpQuote.js';
const payer=new PublicKey('8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ');
const swapProgram=new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const wsol=new PublicKey('So11111111111111111111111111111111111111112');
const a=Keypair.generate().publicKey,b=Keypair.generate().publicKey;
const p1=Keypair.generate().publicKey,p2=Keypair.generate().publicKey;
const sink=Keypair.generate().publicKey;
const extra=Keypair.generate().publicKey;
const buyback=Keypair.generate().publicKey;
const amount='20000000';
const ixs=[
 SystemProgram.transfer({fromPubkey:payer,toPubkey:sink,lamports:Number(amount)}),
 new TransactionInstruction({programId:swapProgram,keys:[
  {pubkey:p1,isSigner:false,isWritable:true},
  {pubkey:p2,isSigner:false,isWritable:true},
  {pubkey:a,isSigner:false,isWritable:false},
  {pubkey:b,isSigner:false,isWritable:false}],data:Buffer.from([1])})
];
const tx=new VersionedTransaction(new TransactionMessage({
 payerKey:payer,recentBlockhash:Keypair.generate().publicKey.toBase58(),
 instructions:ixs
}).compileToV0Message()).serialize();
const sha=createHash('sha256').update(tx).digest('hex');
const data1=Buffer.alloc(120);data1[0]=1;
const data2=Buffer.alloc(120);data2[0]=2;
const acc=(data:Buffer,owner=swapProgram):AccountInfo<Buffer>=>({
 data,owner,lamports:1,rentEpoch:0,executable:false
});
let rpcCalls=0;
function sdk(override:{wrongMint?:boolean;wrongOutput?:boolean;
 wrongInstructions?:boolean;alterSwapData?:boolean;alterSwapKey?:boolean}={}):EchoOfficialPumpSdkAdapter{
 return {
  async multiHopPoolHops(keys){
   assert.deepEqual(keys.map(k=>k.toBase58()),[p1.toBase58(),p2.toBase58()]);
   return {hops:[{},{}],globalConfig:{buybackFeeRecipients:[buyback]},feeConfig:{}};
  },
  decodePool(info){return info.data[0]===1?
   {baseMint:a,quoteMint:wsol,isMayhemMode:false}:
   {baseMint:override.wrongMint?a:b,quoteMint:a,isMayhemMode:false};
  },
  amount(v){assert.equal(v,amount);return v;},
  quote(){return {minAmountOut:{toString:()=>override.wrongOutput?'1001':'900'},
   amountOut:{toString:()=> '1000'}};},
  async swapInstructions(){
   if(override.wrongInstructions)return ixs.slice(1);
   if(override.alterSwapData||override.alterSwapKey)
    return [ixs[0],new TransactionInstruction({
     programId:swapProgram,
     keys:override.alterSwapKey?
      [...ixs[1].keys.slice(0,4),{pubkey:extra,
       isSigner:false,isWritable:false}]:ixs[1].keys,
     data:Buffer.from([override.alterSwapData?2:1])
    })];
   return ixs;
  }
 };
}
function rpc(badOwner=false):EchoOfficialPumpQuoteRpc{
 return {
  async getMultipleAccountsInfo(keys,commitment){
   rpcCalls++;
   assert.equal(commitment,'confirmed');
   assert.deepEqual(keys.map(k=>k.toBase58()),[p1.toBase58(),p2.toBase58()]);
   return [acc(data1,badOwner?SystemProgram.programId:swapProgram),acc(data2)];
  },
  async getFeeForMessage(){return {context:{slot:100},value:5000};}
 };
}
const input=(s=sdk(),r=rpc())=>({
 sdk:s,rpc:r,unsignedBytes:tx,expectedUnsignedSha256:sha,
 firstPool:p1.toBase58(),secondPool:p2.toBase58(),
 intermediateMint:a.toBase58(),targetMint:b.toBase58(),
 principalLamports:amount,slippageBps:1000
});
test('independent SDK pool mint route and exact reconstructed bytes match, no broadcast',async()=>{
 const result=await inspectSignerOwnedOfficialPumpQuote(input());
 assert.equal(result.ok,true,JSON.stringify(result));
 if(result.ok){
  assert.equal(result.quotedOutputRaw,'1000');
  assert.equal(result.minOutputRaw,'900');
  assert.equal(result.networkFeeLamports,'5000');
  assert.equal(result.cpiAndRentFullyAudited,false);
  assert.equal(result.manualPhantomSellVerified,false);
  assert.equal(result.signingAllowed,false);
  assert.equal(result.broadcastAllowed,false);
 }
 assert.equal(ECHO_OFFICIAL_PUMP_QUOTE_CAN_BROADCAST,false);
});
test('bad pool owner, mint continuity, min output or rebuilt instruction deny',async()=>{
 for(const entry of [
  input(sdk(),rpc(true)),
  input(sdk({wrongMint:true})),
  input(sdk({wrongOutput:true})),
  input(sdk({wrongInstructions:true}))
 ]){
  const result=await inspectSignerOwnedOfficialPumpQuote(entry);
  assert.equal(result.ok,false,JSON.stringify(result));
 }
});
test('tampered message hash and invalid principal reject before RPC',async()=>{
 rpcCalls=0;
 for(const change of [
  {expectedUnsignedSha256:'f'.repeat(64)},
  {principalLamports:'100000001'},
  {slippageBps:1001}
 ]){
  const result=await inspectSignerOwnedOfficialPumpQuote({
   ...input(),...change});
  assert.equal(result.ok,false,JSON.stringify(change));
 }
 assert.equal(rpcCalls,0);
});

test('rebuilding exact transaction rejects differing SDK instruction bytes and account list',async()=>{
 const data=await inspectSignerOwnedOfficialPumpQuote(input(sdk({alterSwapData:true})));
 assert.deepEqual(data,{ok:false,
  reason:'OFFICIAL_REBUILD_INSTRUCTION_DATA_DIFFERED',
  signingAllowed:false,broadcastAllowed:false});
 const keys=await inspectSignerOwnedOfficialPumpQuote(input(sdk({alterSwapKey:true})));
 assert.deepEqual(keys,{ok:false,
  reason:'OFFICIAL_REBUILD_ACCOUNT_KEY_COUNT_DIFFERED',
  signingAllowed:false,broadcastAllowed:false});
});

test('SDK-generated changing account list is rejected even with identical pool snapshot',async()=>{
 let counter=0;
 const sdkAdapter=sdk();
 const original=sdkAdapter.swapInstructions.bind(sdkAdapter);
 sdkAdapter.swapInstructions=async x=>{
  counter++;
  const instructions=await original(x);
  return [...instructions,new TransactionInstruction({
   programId:swapProgram,
   keys:[{pubkey:Keypair.generate().publicKey,
    isWritable:false,isSigner:false}],
   data:Buffer.from([counter])
  })];
 };
 const result=await inspectSignerOwnedOfficialPumpQuote(input(sdkAdapter));
 assert.deepEqual(result,{ok:false,
  reason:'SDK_SNAPSHOT_PUMPSWAP_ACCOUNT_ADDRESS_DRIFT',
  signingAllowed:false,broadcastAllowed:false});
});

test('changing associated-token account address is identified and still blocked',async()=>{
 let calls=0;
 const sdkAdapter=sdk();
 const original=sdkAdapter.swapInstructions.bind(sdkAdapter);
 sdkAdapter.swapInstructions=async x=>{
  calls++;
  const base=await original(x);
  return [...base,new TransactionInstruction({
   programId:new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
   keys:[{pubkey:Keypair.generate().publicKey,
    isWritable:true,isSigner:false}],
   data:Buffer.alloc(0)
  })];
 };
 const res=await inspectSignerOwnedOfficialPumpQuote(input(sdkAdapter));
 assert.deepEqual(res,{ok:false,reason:'SDK_SNAPSHOT_ATA_ACCOUNT_ADDRESS_DRIFT',
  signingAllowed:false,broadcastAllowed:false});
 assert.equal(calls,2);
});

test('official recipient is selected from independently fetched config on every swap build',async()=>{
 const observed:string[]=[];
 const adapter=sdk();
 const original=adapter.swapInstructions.bind(adapter);
 adapter.swapInstructions=async x=>{
  observed.push(x.buybackFeeRecipient?.toBase58()??'UNPINNED');
  return original(x);
 };
 const result=await inspectSignerOwnedOfficialPumpQuote(input(adapter));
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.deepEqual(observed,[buyback.toBase58(),buyback.toBase58()]);
});
test('missing verified buyback list stops before SDK construction',async()=>{
 let builds=0;
 const adapter=sdk();
 adapter.multiHopPoolHops=async()=>({
  hops:[{},{}],globalConfig:{},feeConfig:{}
 });
 adapter.swapInstructions=async()=>{builds++;return ixs;};
 const result=await inspectSignerOwnedOfficialPumpQuote(input(adapter));
 assert.deepEqual(result,{ok:false,
  reason:'INDEPENDENT_BUYBACK_RECIPIENT_LIST_MISSING_OR_INVALID',
  signingAllowed:false,broadcastAllowed:false});
 assert.equal(builds,0);
});
