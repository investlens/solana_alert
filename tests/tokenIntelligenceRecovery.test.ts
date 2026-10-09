import test from 'node:test';import assert from 'node:assert/strict';
import {analyzeRobinhoodToken} from '../src/services/tokenIntelligenceService.js';
import {renderTokenIntelligence} from '../src/ui/tokenIntelligenceView.js';
type Sources=NonNullable<Parameters<typeof analyzeRobinhoodToken>[3]>;
const token='0x'+'a'.repeat(40),creator='0x'+'b'.repeat(40);
const raw=10n**27n;
const context={name:'Agent City',symbol:'AGENT',creator,decimals:18,totalSupplyRaw:raw,priceUsd:0.000008,fdvUsd:8000,phase:0,venue:'curve',curveAddress:'0x'+'c'.repeat(40),twitter:'https://x.com/project',telegram:'https://t.me/project'};
function mockSources():Sources{return {
 metadata:async()=>({address:token,name:'Agent City',symbol:'AGENT',decimals:18,totalSupplyRaw:null,bytecodeExists:true,readErrors:['supply unavailable']}),
 pairs:async()=>[],pons:async()=>context,supply:async()=>({totalSupplyRaw:raw,decimals:18,blockNumber:1n,checkedAt:new Date().toISOString()}),
 holders:async(_token,options)=>{assert.equal(options?.metadata?.totalSupplyRaw,raw);return {holderCountObserved:2,top10Pct:10,top1Pct:6,concentrationRisk:'LOW',warnings:[],sampledWallets:[]};},
 database:async()=>{throw new Error('history unavailable');}, holding:async()=>1.2,
 fresh:async()=>({oneDayPct:null,verifiedFresh:0,notFresh:0,unknown:0,classified:0,coveragePct:null,sampleSize:0,evidence:'UNKNOWN',methodology:'none'}),
 paid:async()=>({dexPaid:true}),graduation:async()=>false,
} as unknown as Sources;}
test('PONS price, creator holdings, paid event and recovered holder denominator survive failed history lookup',async()=>{
 const sources=mockSources();const result=await analyzeRobinhoodToken(token,null,1500,sources);
 assert.equal(result.price,context.priceUsd);assert.equal(result.fdv,8000);assert.equal(result.marketCap,null);
 assert.equal(result.developer.wallet,creator);assert.equal(result.developer.holdingPct,1.2);
 assert.equal(result.holders.top10Pct,10);assert.equal(result.security.dexPaid,true);assert.equal(result.supply,raw.toString());
 assert.equal(result.launchpad,'PONS');assert.equal(result.socials.length,2);assert.equal(result.status,'PARTIAL');
 const text=renderTokenIntelligence(result);assert.match(text,/Verified PONS origin/);assert.match(text,/SOCIALS/);assert.doesNotMatch(text,/Total supply unavailable|Current market data <b>unavailable/);
});
test('PONS data survives holder failure and analysis deadline with hung history',async()=>{
 const sources=mockSources();sources.holders=async()=>{throw new Error('holder failed');};sources.database=()=>new Promise(()=>{});
 const result=await analyzeRobinhoodToken(token,null,100,sources);
 assert.equal(result.price,context.priceUsd);assert.equal(result.developer.holdingPct,1.2);assert.equal(result.security.dexPaid,true);
 assert.equal(result.holders.top10Pct,null);assert.equal(result.status,'PARTIAL');
});
test('holding measurements are not reassigned to a conflicting creator from historical evidence',async()=>{
 const sources=mockSources(),other='0x'+'d'.repeat(40);
 sources.database=(async()=>({latest:{raw_snapshot:{deployerAddress:other}},historicalPrice:[],historicalMc:null,boostTotal:null,dexPaid:null,creatorRows:[]})) as Sources['database'];
 const result=await analyzeRobinhoodToken(token,null,1500,sources);
 assert.equal(result.developer.wallet,other);assert.equal(result.developer.holdingPct,null);
 assert.equal(result.security.dexPaid,true);
});

test('fresh creator balance wins over an older stored zero; fresh zero wins over old nonzero',async()=>{
 for(const [fresh,stored] of [[1.2,0],[0,10]]){
  const sources=mockSources();sources.holding=async()=>fresh;
  sources.database=(async()=>{await new Promise(resolve=>setTimeout(resolve,20));return {
   latest:{alerted_at:'2026-01-01T00:00:00Z',raw_snapshot:{deployerAddress:creator,devHoldingPercent:stored}},
   historicalPrice:[],historicalMc:null,boostTotal:null,dexPaid:null,creatorRows:[]};}) as Sources['database'];
  const result=await analyzeRobinhoodToken(token,null,1500,sources);
  assert.equal(result.developer.holdingPct,fresh);
  assert.ok(Date.parse(result.developer.holdingObservedAt!)>Date.parse('2026-01-01T00:00:00Z'));
 }
});
