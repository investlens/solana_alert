import test from 'node:test';import assert from 'node:assert/strict';
import {encodeAbiParameters,encodeEventTopics,keccak256,parseAbiParameters,parseAbiItem} from 'viem';
import {assessObservedSales,saleFromReceipt,createArcObservedVerifier,ARC_SWAP,ARC_USDC} from '../src/chains/arc/observedSelling.js';
import {arcDeliverySafety,arcLiquidityDisclosure} from '../src/chains/arc/promotionPolicy.js';
import {ARC_UNISWAP_V4_POOL_MANAGER as manager} from '../src/chains/arc/uniswap.js';
const address=(n:number)=>`0x${n.toString(16).padStart(40,'0')}` as `0x${string}`;
const hash=(n:number)=>`0x${n.toString(16).padStart(64,'0')}` as `0x${string}`;
const token=address(1),wallet=address(2),router=address(3),pool=hash(9),now=1_000_000;
const transfer=parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 value)');
function fixture(){
 const tx={hash:hash(1),from:wallet,blockNumber:8n,blockHash:hash(8)};
 const log=(address:string,topics:any,data:any)=>({address,topics,data,transactionHash:tx.hash,blockNumber:tx.blockNumber,blockHash:tx.blockHash,removed:false});
 const receipt={status:'success',transactionHash:tx.hash,blockNumber:tx.blockNumber,blockHash:tx.blockHash,logs:[
  log(manager,encodeEventTopics({abi:[ARC_SWAP],eventName:'Swap',args:{id:pool,sender:router}}),encodeAbiParameters(parseAbiParameters('int128,int128,uint160,uint128,int24,uint24'),[-100n,20_000_000n,1n,1n,0,3000])),
  log(token,encodeEventTopics({abi:[transfer],eventName:'Transfer',args:{from:wallet,to:manager}}),encodeAbiParameters(parseAbiParameters('uint256'),[100n])),
  log(ARC_USDC,encodeEventTopics({abi:[transfer],eventName:'Transfer',args:{from:manager,to:wallet}}),encodeAbiParameters(parseAbiParameters('uint256'),[20_000_000n])),
 ]};return {token,poolId:pool,tokenIs0:true,transaction:tx,receipt,at:now,code:'0x' as const};
}
const sales=(count=4)=>Array.from({length:count},(_,i)=>({wallet:address(i+2),tx:hash(i+1),at:now-1000,usdc:20_000_000n}));
test('receipt attribution uses actual sender, exact pool and both net settlements',()=>{
 const f=fixture();assert.deepEqual(saleFromReceipt(f),{wallet,tx:hash(1),at:now,usdc:20_000_000n});
 f.transaction.from=router;assert.equal(saleFromReceipt(f),null);
});
test('failed, removed, mismatched, contract, partial and ambiguous receipts never count',()=>{
 for(const mutate of [f=>f.receipt.status='reverted',f=>f.code='0x1234',f=>f.code=undefined,f=>f.receipt.logs[0].removed=true,f=>f.transaction.blockHash=hash(7),f=>f.receipt.logs.pop(),f=>f.receipt.logs.push({...f.receipt.logs[0]}),f=>f.poolId=hash(99),f=>f.tokenIs0=false]){
  const f:any=fixture();mutate(f);assert.equal(saleFromReceipt(f),null);
 }
 const f=fixture();f.receipt.logs[2].data=encodeAbiParameters(parseAbiParameters('uint256'),[21_000_000n]);assert.equal(saleFromReceipt(f),null);
});
test('at least four distinct sellers, meaningful amounts and recent receipts required',()=>{
 assert.equal(assessObservedSales(sales(),now).allowed,true);
 for(let n=0;n<=3;n++)assert.equal(assessObservedSales(sales(n),now).allowed,false);
 assert.equal(assessObservedSales(sales().map(x=>({...x,wallet})),now).allowed,false);
 assert.equal(assessObservedSales(sales().map(x=>({...x,usdc:1n})),now).allowed,false);
 assert.equal(assessObservedSales(sales().map(x=>({...x,at:now-300001})),now).allowed,false);
 assert.equal(assessObservedSales(sales().map(x=>({...x,at:now+1})),now).allowed,false);
 assert.equal(assessObservedSales(sales(),now,wallet).allowed,false);
 assert.equal(assessObservedSales([...sales(),...sales()],now).sells,4);
 assert.equal(assessObservedSales(sales().map((x,i)=>({...x,usdc:i?5_000_000n:100_000_000n})),now).allowed,false);
});
test('observed route does not claim simulation or LP protection; confirmed restrictions block',async()=>{
 const observe=async()=>({...assessObservedSales(sales(),now),poolId:pool});
 const result=await arcDeliverySafety('ARC_OPPORTUNITY',token,async()=>({allowed:true,reason:'flags clear'}),undefined,observe,pool);
 assert.equal(result.allowed,true);assert.equal(result.sellabilityVerified,false);assert.equal(result.sellabilityMethod,'OBSERVED_SELLS');assert.equal(result.lpStatus,'UNKNOWN');assert.match(result.reason,/RISKY ALERT/);
 for(const check of [async()=>({allowed:false,reason:'unknown'}),async()=>({allowed:false,sellabilityBlocked:true,reason:'honeypot'})])assert.equal((await arcDeliverySafety('ARC_BOOST',token,check,undefined,observe)).allowed,false);
 assert.equal((await arcDeliverySafety('ARC_BOOST',token,async()=>({allowed:true,reason:'clear'}),async()=>({allowed:false,reason:'Sell simulation reverted',observedAt:now}),observe)).allowed,false);
 assert.match(arcLiquidityDisclosure('LOCKED'),/Liquidity protection verified/);assert.doesNotMatch(arcLiquidityDisclosure('BURNED'),/safe/i);
});
test('collector bounds starts, receipts, plain pool identity and cache',async()=>{
 let clock=now,calls=0;
 const poolId=keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'),[token,ARC_USDC as any,3000,60,address(0)]));
 const verify=createArcObservedVerifier({now:()=>clock,pairs:async()=>[{chainId:'arc',dexId:'uniswap',baseToken:{address:token},quoteToken:{address:ARC_USDC},pairAddress:poolId,liquidity:{usd:5000},txns:{m5:{sells:11}}}],head:async()=>1000n,logs:async()=>Array.from({length:30},(_,i)=>({args:{id:poolId},blockNumber:998n,transactionHash:hash(i+1)})),transaction:async h=>{calls++;return {hash:h,from:wallet};},receipt:async h=>({transactionHash:h,status:'reverted',blockNumber:998n}),block:async()=>{throw Error('should not read failed receipt');},code:async()=>{throw Error('should not read failed receipt');}});
 assert.equal((await verify(token)).allowed,false);assert.equal(calls,12);await verify(token);assert.equal(calls,12);
 await verify(address(7));assert.equal(calls,12);assert.match((await verify(address(8))).reason,/budget busy/);
 clock+=60001;assert.equal((await verify(token)).allowed,false);assert.equal(calls,24);
});
test('native USDC uses only the 18-decimal system emitter, never the mirrored ERC20 credit',()=>{
 const f:any=fixture();f.nativeQuote=true;
 f.receipt.logs[0].data=encodeAbiParameters(parseAbiParameters('int128,int128,uint160,uint128,int24,uint24'),[-100n,20n*10n**18n,1n,1n,0,3000]);
 f.receipt.logs.push({...f.receipt.logs[2],address:'0xfffffffffffffffffffffffffffffffffffffffe',data:encodeAbiParameters(parseAbiParameters('uint256'),[20n*10n**18n])});
 assert.equal(saleFromReceipt(f)?.usdc,20_000_000n);
 f.receipt.logs.pop();assert.equal(saleFromReceipt(f),null);
});
test('collector qualifies receipt-backed distinct wallets and expires the cached evidence',async()=>{
 let clock=now,reads=0;
 const pair=keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'),[token,ARC_USDC as any,3000,60,address(0)]));
 const fixtures=Array.from({length:4},(_,i)=>{
  const f=fixture();const original=f.transaction.hash;const seller=address(i+2);f.transaction={...f.transaction,hash:hash(i+1),from:seller,blockNumber:998n,blockHash:hash(998)};
  f.receipt={...f.receipt,transactionHash:f.transaction.hash,blockNumber:998n,blockHash:hash(998),logs:f.receipt.logs.map(l=>({...l,transactionHash:f.transaction.hash,blockNumber:998n,blockHash:hash(998)}))};
  f.receipt.logs[0].topics=encodeEventTopics({abi:[ARC_SWAP],eventName:'Swap',args:{id:pair,sender:router}});
  f.receipt.logs[1].topics=encodeEventTopics({abi:[transfer],eventName:'Transfer',args:{from:seller,to:manager}});
  f.receipt.logs[2].topics=encodeEventTopics({abi:[transfer],eventName:'Transfer',args:{from:manager,to:seller}});
  return f;
 });
 const verify=createArcObservedVerifier({now:()=>clock,pairs:async()=>[{chainId:'arc',dexId:'uniswap',baseToken:{address:token},quoteToken:{address:ARC_USDC},pairAddress:pair,liquidity:{usd:5000},txns:{m5:{sells:4}}}],head:async()=>1000n,logs:async()=>fixtures.map(f=>({transactionHash:f.transaction.hash,blockNumber:998n,args:{id:pair}})),transaction:async h=>{reads++;return fixtures.find(f=>f.transaction.hash===h)!.transaction;},receipt:async h=>fixtures.find(f=>f.transaction.hash===h)!.receipt,block:async()=>({hash:hash(998),timestamp:BigInt((now-299000)/1000)}),code:async()=> '0x'});
 const result=await verify(token);assert.equal(result.allowed,true);assert.equal(result.sellers,4);assert.equal(result.totalUsdc,80);
 await verify(token);assert.equal(reads,4);clock+=1001;assert.equal((await verify(token)).allowed,false);
});
test('observed route cannot waive unknown hooks and formatting preserves evidence',async()=>{
 const {assessArcForAlert}=await import('../src/chains/arc/alertGate.js');
 const {polishArcTelegramPresentation}=await import('../src/chains/arc/telegramPresentation.js');
 const market:any={assetId:token,hooks:address(99),safetyReasons:[],contractCodePresent:true,metadataReadable:true,liquidityUsd:5000,volume5mUsd:2000,buys5m:20,sells5m:11};
 const decision=assessArcForAlert(market,{allowed:true,reason:'observed',sellabilityMethod:'OBSERVED_SELLS'});assert.equal(decision.alertable,false);assert.ok(decision.security.reasons.includes('UNVERIFIED_V4_HOOK'));
 const text=`🚀 <b>BOOST DETECTED · ARC</b>\n<b>ABC</b>\n<code>${token}</code>\n⚠️ <b>RISKY ALERT — LIQUIDITY PROTECTION UNVERIFIED</b>\nObserved sells (last 5m): 4 transactions · 4 distinct wallets · $80.00 USDC received\nCreator excluded when known; linked-wallet funding not verified.`;
 const rendered=polishArcTelegramPresentation(text).text;assert.match(rendered,/RISKY ALERT/);assert.match(rendered,/4 distinct wallets/);assert.match(rendered,/linked-wallet funding not verified/);assert.doesNotMatch(rendered,/No honeypot/);
});
