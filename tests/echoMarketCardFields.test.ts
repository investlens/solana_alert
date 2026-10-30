import test from 'node:test';
import assert from 'node:assert/strict';
import { echoCard, type EchoSignal } from '../src/echo/signals.js';

const base: EchoSignal = {
 id:'incident:caller:mint:BUY',wallet:'5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',
 caller:'WHALE · slingoor',signature:'3'.repeat(88),timestamp:100,
 mint:'4'.repeat(44),side:'BUY',tokenAmount:12100,quoteAmount:0.1,quoteSymbol:'SOL'
};

test('immediate caller alert shows confirmed trade without awaiting optional market data',()=>{
 const card=echoCard(base,101);
 assert.match(card,/Slingoor|SLINGOOR/);
 assert.match(card,/Trade:/);
 assert.doesNotMatch(card,/24h volume|24h buys|Pair:/);
});
test('post-send enrichment adds verified 24h volume, buys, DEX, pair and price',()=>{
 const card=echoCard(base,101,{name:'Sample',symbol:'SMP',marketCap:80000,liquidity:30000,
  volume24h:124567,buys24h:183,dex:'pumpswap',pairAddress:'5'.repeat(44),priceUsd:0.0000123});
 assert.match(card,/24h volume:/);
 assert.match(card,/124,567/);
 assert.match(card,/24h buys:<\/b> 183/);
 assert.match(card,/pumpswap/);
 assert.match(card,/Pair:/);
 assert.match(card,/0\.000012300/);
});
test('missing stats remain omitted and external text is HTML escaped',()=>{
 const card=echoCard(base,101,{name:'A <B>',symbol:'x&y',marketCap:null,liquidity:null,
  volume24h:null,buys24h:null,dex:'bad <html>',pairAddress:null,priceUsd:null});
 assert.match(card,/A &lt;B&gt;/);
 assert.match(card,/x&amp;y/);
 assert.match(card,/bad &lt;html&gt;/);
 assert.doesNotMatch(card,/24h volume|24h buys|Pair:/);
});
