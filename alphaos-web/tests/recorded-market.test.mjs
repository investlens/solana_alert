import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {recordedMarket, finiteNumber, addressKey, chartFor, validDate} from '../lib/dashboard/recorded-market.ts';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/recorded-market.json',import.meta.url),'utf8'));
const now=Date.parse('2026-10-05T17:00:00Z');
const stompy=fixtures.find(r=>r.raw_data.symbol==='Stompy');
const aottr=fixtures.find(r=>r.raw_data.symbol==='AOTTR');
const praetor=fixtures.find(r=>r.raw_data.symbol==='PRAETOR');
const launch={token_address:praetor.asset_id,chain:'robinhood',curve_address:'0xc799529bc6ad4c7e0803b59a253be81a58024f86',pool_address:null,protocol_version:'v2-current'};
test('Stompy uses the latest full snapshot, never the old volume or trades',()=>{
 const m=recordedMarket(stompy,undefined,false,now);
 assert.equal(m.price,0.00003827);assert.equal(m.liquidity,20.28);
 assert.equal(m.marketCap,38279);assert.equal(m.volume5m,null);
 assert.equal(m.buys5m,0);assert.equal(m.sells5m,0);
 assert.equal(m.riskLevel,'HIGH');assert.equal(m.confidence,18);
 assert.equal(m.observedAt,'2026-10-05T16:15:28.396Z');assert.equal(m.stale,true);
 assert.equal(m.launchpad,null);assert.equal(m.peakMarketCap,56242);
 assert.match(m.chartUrl,/385daf/);
});
test('AOTTR retains exactly recorded stats without inventing a PONS origin',()=>{
 const m=recordedMarket(aottr,undefined,false,now);
 assert.equal(m.price,0.00001805);assert.equal(m.marketCap,1805350);
 assert.equal(m.liquidity,415519.64);assert.equal(m.volume5m,67766.21);
 assert.equal(m.buys5m,25);assert.equal(m.sells5m,48);assert.equal(m.launchpad,null);
 assert.equal(m.riskLevel,'MEDIUM');assert.match(m.chartUrl,/dexscreener/);
});
test('known curve venue cannot inherit dust DEX market values',()=>{
 const m=recordedMarket(praetor,launch,false,now);
 assert.equal(m.venuePending,true);assert.equal(m.price,null);
 assert.equal(m.marketCap,null);assert.equal(m.liquidity,null);
 assert.equal(m.confidence,null);assert.equal(m.launchpad,'PONS');
});
test('failed launch lookup withholds market stats but preserves recorded danger',()=>{
 const m=recordedMarket(stompy,undefined,true,now);
 assert.equal(m.marketCap,null);assert.equal(m.riskLevel,'HIGH');
});
test('wrong embedded token or chain cannot contribute facts',()=>{
 for(const overrides of [{token:'0x1234'},{chain:'arc'}]){
 const m=recordedMarket({...aottr,raw_data:{...aottr.raw_data,...overrides}},undefined,false,now);
 assert.equal(m.identityMatches,false);assert.equal(m.price,null);assert.equal(m.riskLevel,'UNKNOWN');assert.equal(m.chartUrl,null);
 }
});
test('unknown is not zero; number coercion rejects booleans, arrays and objects',()=>{
 for(const v of [null,undefined,'',' ',true,false,[],{},'NaN','0x10',Infinity])assert.equal(finiteNumber(v),null);
 assert.equal(finiteNumber(0),0);assert.equal(finiteNumber('0'),0);
});
test('missing current observation values do not fall back to top-level or old fields',()=>{
 const m=recordedMarket({...aottr,raw_data:{...aottr.raw_data,observations:[{observedAt:'2026-10-05T16:24:30.601Z'}]}},undefined,false,now);
 assert.equal(m.price,null);assert.equal(m.liquidity,null);assert.equal(m.volume5m,null);assert.equal(m.buys5m,null);
});
test('older row cap cannot be attached to a newer observation',()=>{
 const m=recordedMarket({...aottr,updated_at:'2026-10-05T15:00:00Z'},undefined,false,now);
 assert.equal(m.marketCap,null);
});
test('unsorted observation arrays select by timestamp',()=>{
 const m=recordedMarket({...stompy,raw_data:{...stompy.raw_data,observations:[...stompy.raw_data.observations].reverse()}},undefined,false,now);
 assert.equal(m.price,0.00003827);
});
test('missing, invalid and future observation times cannot look fresh',()=>{
 for(const observedAt of [null,'bad','2026-10-06T12:00:00Z']){
 const m=recordedMarket({...aottr,raw_data:{...aottr.raw_data,observations:[{price:1,observedAt}]}},undefined,false,now);
 assert.equal(m.observedAt,null);assert.equal(m.venuePending,true);assert.equal(m.price,null);assert.equal(m.stale,true);
 }
 assert.equal(validDate('bad',now),null);
});
test('DEX chart must match chain and pair and reject arbitrary hosts',()=>{
 const raw=aottr.raw_data;
 for(const url of ['javascript:alert(1)','https://evil.test/robinhood/'+raw.pairAddress,'https://dexscreener.com/arc/'+raw.pairAddress,'https://dexscreener.com/robinhood/0x123','https://dexscreener.com/robinhood/'+raw.pairAddress+'?x=1'])assert.equal(chartFor({...raw,chartUrl:url},'robinhood'),null);
});
test('EVM comparisons normalize hex casing; Solana identifiers retain case',()=>{
 assert.equal(addressKey('0xABC123'),'0xabc123');assert.notEqual(addressKey('AbcMint'),addressKey('abcMint'));
});
test('negative statistics are unavailable and explicit zero remains zero',()=>{
 const m=recordedMarket({...aottr,raw_data:{observedAt:'2026-10-05T16:24:30Z',marketCap:-1,liquidity:0,volume5m:-1}},undefined,false,now);
 assert.equal(m.marketCap,null);assert.equal(m.liquidity,0);assert.equal(m.volume5m,null);
});
test('confirmed venue evidence must belong to the same observed snapshot',()=>{
 const raw={...praetor.raw_data,marketEvidence:{token:praetor.asset_id.toUpperCase().replace('0X','0x'),chain:'robinhood',venueConfirmed:true,venue:'PONS_CURVE',curveAddress:launch.curve_address,observedAt:'2026-10-05T16:27:28.219Z'}};
 assert.equal(recordedMarket({...praetor,raw_data:raw},launch,false,now).venuePending,false);
 assert.equal(recordedMarket({...praetor,raw_data:{...raw,marketEvidence:{...raw.marketEvidence,observedAt:'2026-10-05T15:00:00Z'}}},launch,false,now).venuePending,true);
});
test('fractional trade counts are rejected',()=>{
 const m=recordedMarket({...aottr,raw_data:{observedAt:'2026-10-05T16:24:30Z',buys5m:1.2,sells5m:0}},undefined,false,now);
 assert.equal(m.buys5m,null);assert.equal(m.sells5m,0);
});
