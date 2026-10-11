import test from 'node:test';import assert from 'node:assert/strict';
import {prefetchRobinhoodScannerPairs,getRobinhoodMarketSnapshot} from '../src/chains/robinhood/market.js';
import {selectExistingTokenBatchCandidates} from '../src/chains/robinhood/existingTokenOpportunityScanner.js';
import {resetDexScreenerGovernorForTests} from '../src/services/dexscreenerRequestGovernor.js';
const token='0x'+'1'.repeat(40),missing='0x'+'2'.repeat(40);
test('one batch serves matching market evidence; an omitted token still gets an individual request',async()=>{
 const urls:string[]=[];resetDexScreenerGovernorForTests({fetch:async url=>{urls.push(String(url));return Response.json(String(url).includes('/tokens/v1/')?[
 {chainId:'robinhood',baseToken:{address:token,symbol:'GOOD'},priceUsd:'0.01',marketCap:10000,liquidity:{usd:2000}},
 {chainId:'arc',baseToken:{address:missing},priceUsd:'10'}]:[]);}});
 try{const found=await prefetchRobinhoodScannerPairs([token,missing]);assert.deepEqual([...found],[token]);
 const market=await getRobinhoodMarketSnapshot(token,{caller:'existing_token_scanner'});assert.equal(market?.marketCapUsd,10000);assert.equal(urls.length,1);
 assert.equal(await getRobinhoodMarketSnapshot(missing,{caller:'existing_token_scanner'}),null);assert.equal(urls.length,2);
 }finally{resetDexScreenerGovernorForTests();}
});
test('batch selection keeps analysis bounded and reserves verification for omitted entries',()=>{
 const entries=Array.from({length:24},(_,i)=>({token:String(i),tier:'HOT' as const,lastSeenAt:new Date().toISOString()}));
 const selected=selectExistingTokenBatchCandidates(entries,new Set(entries.slice(0,15).map(e=>e.token)),12);
 assert.equal(selected.length,12);assert.equal(selected.filter(e=>Number(e.token)>=15).length,3);
 assert.equal(selectExistingTokenBatchCandidates(entries,new Set(),12).length,12);
});
