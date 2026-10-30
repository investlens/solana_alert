import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {EchoLocalTradeModel,ECHO_LOCAL_MODEL_NETWORK_ENABLED} from '../src/echo/localIsolatedTradeModel.js';
import {SLINGOOR_WALLET,CHAIRMAN_WALLET} from '../src/echo/liveBuyPolicy.js';
import {probeEchoSignerCustody} from '../src/echo/isolatedCustodyProbe.js';
import {createPrivateKey,sign as signEd25519} from 'node:crypto';

const now=1800000000000;
const mints=Array.from({length:4},()=>Keypair.generate().publicKey.toBase58());
const build=(mint:string,callerWallet=SLINGOOR_WALLET)=>({
 callerWallet,mint,verifiedBuyerSigner:true,originalSwapSucceeded:true,
 verifiedSpend:true,verifiedTokenCredit:true,priceSolUsd:200,
 priceObservedAtMs:now,nowMs:now,spentOrdersToday:0,
 openOrPendingPositions:0,openOrPendingPrincipalUsd:0,
 alreadyReservedOrPurchased:false,killSwitchEngaged:false,maxFeeLamports:500000
});
const ownerId=1234;
const sell=(mint:string,percent:50|100)=>({
 ownerChatId:String(ownerId),senderId:ownerId,chatId:ownerId,
 mint,percent,verifiedTokenBalanceRaw:'1000',heldPositionVerified:true,
 activeSellReservation:false,quoteVerified:true,simulationPassed:true
});
const proof={chainConfirmed:true,balanceZeroVerified:true,proceedsVerified:true,sellSignaturePersisted:true};
test('two parallel $10 local BUYs, third rejected, duplicate never repurchased',async()=>{
 const model=new EchoLocalTradeModel();
 const a=await Promise.all([
  model.modelBuy(build(mints[0]),1000n),
  model.modelBuy(build(mints[1],CHAIRMAN_WALLET),1000n),
  model.modelBuy(build(mints[2]),1000n)
 ]);
 assert.deepEqual(a.map(x=>x.modelled),[true,true,false]);
 assert.equal(model.snapshot.openPositions,2);
 assert.equal(model.snapshot.principalUsd,20);
 assert.equal((await model.modelManualSell(sell(mints[0],50),proof)).modelled,true);
 assert.equal(model.snapshot.openPositions,2);
 assert.equal((await model.modelManualSell(sell(mints[0],100),proof)).modelled,false);
 assert.equal((await model.modelManualSell({...sell(mints[0],100),verifiedTokenBalanceRaw:'500'},proof)).modelled,true);
 assert.equal(model.snapshot.openPositions,1);
 assert.equal((await model.modelBuy(build(mints[0]),1000n)).modelled,false);
 assert.equal((await model.modelBuy(build(mints[2]),1000n)).modelled,true);
 assert.equal(model.snapshot.dailyBuys,3);
 assert.equal((await model.modelBuy(build(mints[3]),1000n)).modelled,false);
 assert.equal(ECHO_LOCAL_MODEL_NETWORK_ENABLED,false);
});
test('kill switch blocks buys but owner manual sell remains available',async()=>{
 const model=new EchoLocalTradeModel();
 assert.equal((await model.modelBuy(build(mints[0]),1000n)).modelled,true);
 model.setBuyKillSwitch(true);
 assert.equal((await model.modelBuy(build(mints[1]),1000n)).modelled,false);
 assert.equal((await model.modelManualSell(sell(mints[0],100),proof)).modelled,true);
 assert.equal(model.snapshot.openPositions,0);
});
test('unauthorized SELL or missing zero-balance proof never frees a slot',async()=>{
 const model=new EchoLocalTradeModel();
 assert.equal((await model.modelBuy(build(mints[0]),1000n)).modelled,true);
 assert.equal((await model.modelManualSell({...sell(mints[0],100),senderId:999},proof)).modelled,false);
 assert.equal((await model.modelManualSell(sell(mints[0],100),
  {...proof,balanceZeroVerified:false})).modelled,false);
 assert.equal(model.snapshot.openPositions,1);
});
test('ephemeral test-only keypair can prove off-chain signer custody without RPC',async()=>{
 const ephemeral=Keypair.generate();
 const der=Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),
  Buffer.from(ephemeral.secretKey.slice(0,32))]);
 const secret=createPrivateKey({key:der,format:'der',type:'pkcs8'});
 const answer=await probeEchoSignerCustody({
  provider:{publicWallet:ephemeral.publicKey.toBase58(),
   signOwnershipMessage:async message=>new Uint8Array(signEd25519(null,Buffer.from(message),secret))},
  expectedWallet:ephemeral.publicKey.toBase58(),audience:'echo-dry-run',nowMs:now
 });
 assert.equal(answer.verified,true);
});
