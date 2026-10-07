import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAlertMarket } from '../src/services/alertMarketSelection.js';
import { buildPromotionEventCard } from '../src/ui/promotionEventCard.js';
import type { ChainMarketSnapshot } from '../src/chains/shared/types.js';
const token='0x'+'1'.repeat(40), now=Date.now();
const market:ChainMarketSnapshot={chain:'robinhood',tokenAddress:token,name:'Mondo',symbol:'MONDO',priceUsd:.00005,marketCapUsd:50000,liquidityUsd:23000,volume5mUsd:100,volume5mReported:true,volume24hUsd:5000,buys5m:3,sells5m:1,trades5mReported:true,pairAddress:'0x'+'2'.repeat(40),chartUrl:'https://dexscreener.com/robinhood/0x'+'2'.repeat(40),timestamp:now};
test('pending PONS venue retains exact-token DEX metrics and chart without losing creator',()=>{
 const stats=selectAlertMarket(token,{source:'PONS venue data pending',creator:token,supply:'1B'},market,now);
 assert.equal(stats.marketCap,50000);assert.equal(stats.creator,token);assert.equal(stats.supply,'1B');assert.match(stats.source!,/mapping unverified/);
 const card=buildPromotionEventCard({text:'Boost 50 total (+50)',token,launchType:'PONS',stats,securityNote:null,buttons:[],kind:'BOOST'});
 assert.match(card.text,/MC.*50K/);assert.ok(card.buttons.flat().some(b=>b.url===market.chartUrl));
});
test('confirmed and reported curve quotes win over DEX pools; mapped market wins',()=>{
 for(const venue of [{preBond:true,price:.00001},{price:.00001,source:'PONS reported curve quote · venue unconfirmed'},{price:.00002,source:'PONS mapped pool'}]) assert.equal(selectAlertMarket(token,venue,market,now).price,venue.price);
});
test('fallback rejects stale, wrong-chain, wrong-token and unusable snapshots',()=>{
 for(const change of [{timestamp:now-90001},{timestamp:now+1},{chain:'solana' as const},{tokenAddress:'wrong'},{priceUsd:0},{liquidityUsd:0},{chartUrl:'https://evil.test/'},{pairAddress:undefined}]) assert.equal(selectAlertMarket(token,null,{...market,...change},now).price,undefined);
});


test('empty prebond and reported PONS quotes do not suppress valid exact-token DEX fallback',()=>{
 for(const venue of [
   {preBond:true,creator:token,supply:'1B'},
   {preBond:true,price:0,creator:token},
   {price:null,source:'PONS reported curve quote · venue unconfirmed',creator:token},
   {preBond:true,price:Number.NaN},
   {preBond:true,price:Number.POSITIVE_INFINITY}
 ]){
  const stats=selectAlertMarket(token,venue,market,now);
  assert.equal(stats.price,market.priceUsd);assert.equal(stats.marketCap,market.marketCapUsd);
  assert.equal(stats.chartUrl,market.chartUrl);assert.equal(stats.preBond,false);
  assert.match(stats.source!,/fallback.*PONS curve quote unavailable/);
  if(venue.creator)assert.equal(stats.creator,token);
 }
});
test('empty PONS quote with no valid alternate keeps unknowns instead of inventing prices',()=>{
 const venue={preBond:true,creator:token,supply:'1B'};
 assert.deepEqual(selectAlertMarket(token,venue,null,now),venue);
 assert.deepEqual(selectAlertMarket(token,venue,{...market,timestamp:now-90001},now),venue);
});
