import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDexEvidence } from '../src/chains/robinhood/setupMarketEvidence.js';
const token='0x'+'1'.repeat(40); const pairAddress='0x'+'2'.repeat(40);
const pair={chainId:'robinhood',baseToken:{address:token},pairAddress,priceUsd:'0.001',liquidity:{usd:10000},marketCap:50000,fdv:80000};
test('graduated setup uses exact-chain/base-token USD market and preserves MC/FDV distinction',()=>{
  assert.deepEqual(setupDexEvidence([pair],token,123),{price:0.001,depth:10000,at:123,source:'DEX',pair:pairAddress,marketCap:50000,fdv:80000,volume5m:null,volume24h:null,buys5m:null,sells5m:null});
  assert.equal(setupDexEvidence([{...pair,chainId:'arc'}],token,123),null);
  assert.equal(setupDexEvidence([{...pair,baseToken:{address:pairAddress}}],token,123),null);
  for(const priceUsd of ['0','NaN','Infinity']) assert.equal(setupDexEvidence([{...pair,priceUsd}],token,123),null);
  assert.equal(setupDexEvidence([{...pair,liquidity:{usd:0}}],token,123),null);
  assert.equal(setupDexEvidence([{...pair,marketCap:null}],token,123)?.marketCap,null);
});

test('setup demand fields preserve actual zero and leave missing values unknown',()=>{
 const evidence=setupDexEvidence([{...pair,volume:{m5:0,h24:100},txns:{m5:{buys:0,sells:0}}}],token,123)!;
 assert.equal(evidence.volume5m,0);assert.equal(evidence.volume24h,100);
 assert.equal(evidence.buys5m,0);assert.equal(evidence.sells5m,0);
});
