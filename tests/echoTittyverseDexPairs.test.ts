import test from 'node:test';
import assert from 'node:assert/strict';
import {readSolanaDexPairs,parseSolanaDexPairs} from '../src/echo/tittyverseDexPairs.js';
const btc='C5xph2yL6gMdxmuLGxJBkGpmuDFfyi5fqkBNhvL6pump';
const tao='BDTixhrJpvpqAWyh3GCg4YpToo14bsKyKXuSjTx8pump';
const stranger='8'.repeat(44);
const pair='7'.repeat(44);
const row=(overrides:Record<string,unknown>={})=>({
 chainId:'solana',dexId:'pumpswap',pairAddress:pair,
 baseToken:{address:tao,name:'Tight and Orgasmic',symbol:'TAO'},
 quoteToken:{address:btc,name:'Big Titty Coin',symbol:'BTC'},
 liquidity:{usd:2300},marketCap:4100,...overrides
});
test('read-only verified BTC/TAO DEX pair: one GET, no RPC, no trading',async()=>{
 let calls=0;
 const fetcher=(async(url:string,config:RequestInit)=>{
  calls++;
  assert.equal(url,'https://api.dexscreener.com/tokens/v1/solana/'+btc+','+tao);
  assert.equal(config.method,'GET');
  return new Response(JSON.stringify([row()]),{status:200,
   headers:{'content-type':'application/json'}});
 }) as typeof fetch;
 const result=await readSolanaDexPairs([btc,tao],fetcher,1793510000000);
 assert.equal(calls,1);assert.equal(result.pairs.length,1);
 assert.equal(result.evidence[0].marketCapUsd,4100);
 assert.equal(result.evidence[0].liquidityUsd,2300);
 assert.equal(result.pairs[0].verified,true);
 assert.equal(result.readOnly,true);
});
test('wrong chain, alien pool, malformed mint are not trusted or used in graph',()=>{
 const data=[row({chainId:'ethereum'}),
 row({baseToken:{address:stranger},quoteToken:{address:stranger}}),
 row({pairAddress:'not-an-address'}),row()];
 const result=parseSolanaDexPairs(data,[btc],1793510000000);
 assert.equal(result.pairs.length,1);
 assert.equal(result.unverifiedRows,3);
});
test('429 fails without retry; very large response and duplicate input fail closed',async()=>{
 let n=0;
 const rateLimited=(async()=>{n++;return new Response('',{status:429})}) as typeof fetch;
 await assert.rejects(readSolanaDexPairs([tao],rateLimited),/DEX_RATE_LIMITED_NO_RETRY/);
 assert.equal(n,1);
 await assert.rejects(readSolanaDexPairs([tao,tao],rateLimited),/INVALID_BOUNDED_TOKEN_SELECTION/);
 assert.equal(n,1);
 const oversized=(async()=>new Response('[]',{status:200,
  headers:{'content-type':'application/json','content-length':'900000'}})) as typeof fetch;
 await assert.rejects(readSolanaDexPairs([tao],oversized),/DEX_RESPONSE_TOO_LARGE/);
});
test('missing liquidity or market cap remains unknown not a fabricated zero',()=>{
 const p=parseSolanaDexPairs([row({marketCap:null,liquidity:null})],[tao],1793510000000);
 assert.equal(p.evidence[0].marketCapUsd,null);
 assert.equal(p.evidence[0].liquidityUsd,null);
});
