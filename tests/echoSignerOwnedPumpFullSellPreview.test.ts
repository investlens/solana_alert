import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,TransactionInstruction,SystemProgram}
 from '@solana/web3.js';
import {previewEchoPumpFullSell,ECHO_PUMP_SELL_PREVIEW_CAN_BROADCAST}
 from '../src/echo/signerOwnedPumpFullSellPreview.js';
import type {EchoOfficialPumpSdkAdapter}
 from '../src/echo/signerOwnedOfficialPumpQuote.js';
const p1=Keypair.generate().publicKey,p2=Keypair.generate().publicKey;
const mint=Keypair.generate().publicKey;
const program=new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const instructions=[new TransactionInstruction({
 programId:program,keys:[
 {pubkey:p1,isSigner:false,isWritable:true},
 {pubkey:p2,isSigner:false,isWritable:true},
 {pubkey:mint,isSigner:false,isWritable:false}
 ],data:Buffer.from([1])
})];
const sdk=(opts:{badMin?:boolean;unknown?:boolean}={}):EchoOfficialPumpSdkAdapter=>({
 multiHopPoolHops:async pools=>{
  assert.deepEqual(pools.map(p=>p.toBase58()),[p2.toBase58(),p1.toBase58()]);
  return {hops:[{},{}],globalConfig:{},feeConfig:{}};
 },
 decodePool:()=>{throw Error('not needed');},
 amount:v=>v,
 quote:()=>({minAmountOut:{toString:()=>opts.badMin?'101':'90'},
  amountOut:{toString:()=> '100'}}),
 swapInstructions:async()=>opts.unknown?
  [new TransactionInstruction({programId:SystemProgram.programId,
   keys:[],data:Buffer.from([2])})]:instructions
});
const rpc={
 getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58()}),
 getFeeForMessage:async()=>({context:{slot:123},value:5000})
};
const args=(sdkImpl=sdk())=>({
 sdk:sdkImpl,rpc,targetMint:mint.toBase58(),
 firstPool:p1.toBase58(),secondPool:p2.toBase58(),
 verifiedFullWalletTokenBalanceRaw:'1000000',slippageBps:1000
});
test('canonical reverse-route SDK SELL preview remains read-only and provisional',async()=>{
 const r=await previewEchoPumpFullSell(args());
 assert.equal(r.ok,true,JSON.stringify(r));
 if(r.ok){
  assert.equal(r.minimumSolOutputLamports,'90');
  assert.equal(r.tokenInputRaw,'1000000');
  assert.equal(r.networkFeeLamports,'5000');
  assert.equal(r.fullRentCpiAndPhantomAppVerified,false);
  assert.equal(r.canSign,false);assert.equal(r.canBroadcast,false);
 }
 assert.equal(ECHO_PUMP_SELL_PREVIEW_CAN_BROADCAST,false);
});
test('unknown SELL program, invalid min output and zero holdings block',async()=>{
 for(const variant of [
  args(sdk({badMin:true})),
  args(sdk({unknown:true})),
  {...args(),verifiedFullWalletTokenBalanceRaw:'0'},
  {...args(),slippageBps:1001}
 ]){
  const r=await previewEchoPumpFullSell(variant);
  assert.equal(r.ok,false,JSON.stringify(r));
  assert.equal(r.canBroadcast,false);
 }
});
