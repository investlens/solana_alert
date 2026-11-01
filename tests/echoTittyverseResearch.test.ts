import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateTittyverseSnapshot,TITTYVERSE_AUTO_BUY_ENABLED,TITTYVERSE_ROOT_MINT,SLINGOOR_VERIFIED_WALLET} from '../src/echo/tittyverseResearch.js';
const root=TITTYVERSE_ROOT_MINT;
const TAO='BDTixhrJpvpqAWyh3GCg4YpToo14bsKyKXuSjTx8pump';
const other='4rYEicv2uE1MnV6gB754MivhbXELEPRoykqTp6Mypump';
const p1='7'.repeat(44),p2='8'.repeat(44),p3='9'.repeat(44);
const s1='2'.repeat(88);
const timestamp=1793510000000;
const token=(mint:string,cap:number|null=3000,liquidity:number|null=4000)=>({
 mint,symbol:mint===TAO?'TAO':'TEST',inTittyverse:true,observedAtMs:timestamp,
 marketCapUsd:cap,liquidityUsd:liquidity
});
const pair=(address:string,a:string,b:string)=>({
 pairAddress:address,mintA:a,mintB:b,source:'ONCHAIN' as const,verified:true as const,
 verifiedAtMs:timestamp
});
const buy=(mint:string,at:number=timestamp+10000,additional={})=>({
 mint,wallet:SLINGOOR_VERIFIED_WALLET,signature:s1,
 blockTimeMs:at,signerVerified:true,side:'BUY' as const,transferOnly:false,...additional
});
test('verified graph distinguishes direct BTC pools from deeper 2-hop pool relationships',()=>{
 const results=evaluateTittyverseSnapshot({
  tokens:[token(TAO),token(other,1500,900)],
  pairs:[pair(p1,root,other),pair(p2,other,TAO),pair(p3,TAO,other)],
  buys:[buy(TAO)]
 });
 const tao=results.find(r=>r.mint===TAO)!;
 assert.equal(tao.graphDepth,2);assert.equal(tao.directBtcPool,false);
 assert.equal(tao.verifiedPairCount,2);
 assert.equal(tao.candidate1kTo5k,true);
 assert.equal(tao.discoveredBeforeBuy,true);
 assert.equal(tao.leadTimeSeconds,10);
 assert.equal(tao.action,'RESEARCH_ONLY');
 assert.equal(results.find(r=>r.mint===other)!.thinLiquidity,true);
 assert.equal(TITTYVERSE_AUTO_BUY_ENABLED,false);
});
test('no invented pairs and no imaginary Slingoor BUY from a transfer or other signer',()=>{
 const items=evaluateTittyverseSnapshot({
  tokens:[token(TAO,3500,null)],pairs:[],
  buys:[buy(TAO,timestamp+12000,{transferOnly:true}),buy(TAO,timestamp+20000,{signerVerified:false})]
 });
 assert.equal(items[0].graphDepth,null);
 assert.equal(items[0].noVerifiedPairs,true);
 assert.equal(items[0].slingoorFirstBuyAtMs,null);
 assert.equal(items[0].discoveredBeforeBuy,null);
 assert.equal(items[0].thinLiquidity,true);
});
test('discovered after first verified BUY is not presented as an advance signal',()=>{
 const row=evaluateTittyverseSnapshot({tokens:[token(TAO)],pairs:[],
 buys:[buy(TAO,timestamp-25000)]})[0];
 assert.equal(row.discoveredBeforeBuy,false);
 assert.equal(row.leadTimeSeconds,-25);
});
test('invalid unverified pool, oversized snapshot, duplicate mint or pair fails closed',()=>{
 assert.throws(()=>evaluateTittyverseSnapshot({
  tokens:[token(TAO)],pairs:[{...pair(p1,root,TAO),verified:false as true}],buys:[]
 }),/INVALID_OR_DUPLICATE/);
 assert.throws(()=>evaluateTittyverseSnapshot({
  tokens:[token(TAO),token(TAO)],pairs:[],buys:[]
 }),/INVALID_RESEARCH_TOKEN/);
 assert.throws(()=>evaluateTittyverseSnapshot({
  tokens:[token(TAO)],pairs:[pair(p1,root,TAO),pair(p1,root,other)],buys:[]
 }),/INVALID_OR_DUPLICATE/);
 assert.throws(()=>evaluateTittyverseSnapshot({
  tokens:Array.from({length:501},(_,i)=>token(TAO)),pairs:[],buys:[]
 }),/LIMIT_EXCEEDED/);
});
