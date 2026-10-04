import test from 'node:test';
import assert from 'node:assert/strict';
import { ponsVenueStats, ponsV1VenueStats } from '../src/services/ponsAlertVenue.js';
import { withAlertKeyStats } from '../src/ui/alertKeyStats.js';
import type { PonsPublicContext } from '../src/chains/robinhood/ponsPublicContext.js';
const token='0x'+'1'.repeat(40),pool='0x'+'2'.repeat(64);
const context={name:'Hivemind',symbol:'HIVE',creator:token,decimals:18,totalSupplyRaw:1000000000n*10n**18n,priceUsd:0.000018,fdvUsd:18000,twitter:null,telegram:null,phase:0,venue:'curve',poolId:null} as PonsPublicContext;
const dust={chainId:'robinhood',baseToken:{address:token},pairAddress:'0x'+'3'.repeat(64),priceUsd:'0.0000047',liquidity:{usd:2},marketCap:4600};
test('V1 direct DEX pool supplies market metrics without a V2 graduation requirement',()=>{
  const directPool='0x'+'4'.repeat(40);
  const pair={...dust,pairAddress:directPool,priceUsd:'0.000003835',marketCap:3835,fdv:3835,
    liquidity:{usd:4050.71},volume:{m5:0,h24:34748.17},txns:{m5:{buys:0,sells:0}},priceChange:{h1:-0.41}};
  const result=ponsV1VenueStats(token,directPool,[{...dust,liquidity:{usd:999999}},pair]);
  assert.equal(result.price,0.000003835);assert.equal(result.marketCap,3835);
  assert.equal(result.liquidity,4050.71);assert.equal(result.volume5m,0);assert.equal(result.buys,0);
  assert.equal(result.volume24h,34748.17);assert.equal(result.move1h,-0.41);
  assert.match(result.source!,/PONS V1 mapped pool/);
  assert.equal(ponsV1VenueStats(token,directPool,[dust]).price,undefined);
  assert.equal(ponsV1VenueStats(token,directPool,[{...pair,chainId:'arc'}]).price,undefined);
  assert.equal(ponsV1VenueStats(token,directPool,[{...pair,baseToken:{address:pool}}]).price,undefined);
});
test('prebond PONS valuation wins over unrelated dust pool and replaces printed DEX numbers',()=>{
  const stats=ponsVenueStats(token,context,false,[dust]);
  assert.equal(stats.price,0.000018);assert.equal(stats.fdv,18000);assert.equal(stats.marketCap,null);assert.equal(stats.liquidity,undefined);
  const card=withAlertKeyStats('BOOST\n💰 <b>Market cap</b> $4.6K\n💧 <b>Liquidity</b> $2\n💵 Price $0.0000047\nFDV $4.64K\n5m volume Tracking\nDex Paid Yes\n\n<b>OWNERSHIP</b>\nDev holding Unavailable',stats);
  assert.doesNotMatch(card,/4\.6|\$2\b|0\.0000047|Tracking/);assert.match(card,/FDV.*18K/);assert.match(card,/Bonding curve/);assert.match(card,/Dex Paid Yes/);
});
test('graduated PONS uses only mapped pool and fails closed during indexing or state conflict',()=>{
  const graduated={...context,phase:1,venue:'dex',poolId:pool};
  const actual={...dust,pairAddress:pool,marketCap:50000,priceUsd:'0.00005',liquidity:{usd:20000}};
  assert.equal(ponsVenueStats(token,graduated,true,[dust,actual]).marketCap,50000);
  assert.equal(ponsVenueStats(token,graduated,true,[dust]).price,undefined);
  assert.equal(ponsVenueStats(token,context,true,[actual]).price,undefined);
  assert.equal(ponsVenueStats(token,context,null,[actual]).price,context.priceUsd);
  assert.match(ponsVenueStats(token,context,null,[actual]).source!,/reported.*unconfirmed/);
  assert.equal(ponsVenueStats(token,context,null,[actual]).liquidity,undefined);
  assert.equal(ponsVenueStats(token,graduated,true,[{...actual,chainId:'arc'}]).price,undefined);
});
