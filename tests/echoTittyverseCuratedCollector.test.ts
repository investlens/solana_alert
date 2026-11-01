import test from 'node:test';
import assert from 'node:assert/strict';
import {collectCuratedTittyverseResearch,validateTittyverseLeads} from '../src/echo/tittyverseCuratedCollector.js';
import {TITTYVERSE_ROOT_MINT,SLINGOOR_VERIFIED_WALLET} from '../src/echo/tittyverseResearch.js';

const mint='BDTixhrJpvpqAWyh3GCg4YpToo14bsKyKXuSjTx8pump';
const pairAddress='2VzbjNcAPwsL6v8ZMvtEQBi1JjgGdavhU1GuSgRRL7bM';
const observed=Date.parse('2026-11-01T05:28:53.000Z');
const lead={mint,symbol:'TAO',observedAtMs:observed,
 url:'https://tittyverse.fun/#tittyverse/'+mint,
 provenance:'USER_SHARED_LINK' as const};
const pair={chainId:'solana',dexId:'pumpfun',pairAddress,
 baseToken:{address:mint,symbol:'TAO',name:'Tight and Orgasmic'},
 quoteToken:{address:TITTYVERSE_ROOT_MINT,symbol:'BTC',name:'Big Titty Coin'},
 liquidity:null,marketCap:null};
test('user-shared TAO link produces real DEX BTC pool edge but no claimed verified site listing',async()=>{
 let count=0;
 const fetcher=(async(_url:string,init:RequestInit)=>{
  count++;assert.equal(init.method,'GET');
  return new Response(JSON.stringify([pair]),{status:200,headers:{'content-type':'application/json'}});
 }) as typeof fetch;
 const result=await collectCuratedTittyverseResearch({
  leads:[lead],verifiedBuys:[],fetcher,nowMs:observed+60_000});
 assert.equal(count,1);assert.equal(result.verifiedDexPairs,1);
 assert.equal(result.findings[0].directBtcPool,true);
 assert.equal(result.findings[0].graphDepth,1);
 assert.equal(result.findings[0].marketCapUsd,null);
 assert.equal(result.findings[0].candidate1kTo5k,false);
 assert.equal(result.findings[0].listingEvidence,'USER_SHARED_LINK');
 assert.equal(result.findings[0].siteListingIndependentlyVerified,false);
 assert.equal(result.listingIndependentlyVerified,false);
 assert.equal(result.findings[0].action,'RESEARCH_ONLY');
});
test('caller buys before the actual user-share observation cannot count as early leads',async()=>{
 const oldBuy={wallet:SLINGOOR_VERIFIED_WALLET,mint,
  signature:'2'.repeat(88),blockTimeMs:observed-300_000,side:'BUY' as const,
  signerVerified:true,transferOnly:false};
 const fetcher=(async()=>new Response(JSON.stringify([pair]),{
  status:200,headers:{'content-type':'application/json'}})) as typeof fetch;
 const result=await collectCuratedTittyverseResearch({
  leads:[lead],verifiedBuys:[oldBuy],fetcher,nowMs:observed+300_000});
 assert.equal(result.findings[0].discoveredBeforeBuy,false);
 assert.equal(result.findings[0].leadTimeSeconds,-300);
});
test('non-site URL, wrong mint in deep link and future-dated observations fail before HTTP',async()=>{
 assert.throws(()=>validateTittyverseLeads([{...lead,url:'https://example.com/#tittyverse/'+mint}]),/INVALID_TITTYVERSE_LINK/);
 assert.throws(()=>validateTittyverseLeads([{...lead,url:'https://tittyverse.fun/#tittyverse/'+TITTYVERSE_ROOT_MINT}]),/INVALID_TITTYVERSE_LINK/);
 let calls=0;
 const fetcher=(async()=>{calls++;throw Error('must not call');}) as typeof fetch;
 await assert.rejects(collectCuratedTittyverseResearch({
  leads:[lead],verifiedBuys:[],fetcher,nowMs:observed-100_000}),/INVALID_RESEARCH_OBSERVATION_TIME/);
 assert.equal(calls,0);
});
