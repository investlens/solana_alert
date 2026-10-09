import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCompactOutcome, selectCompactPair, compactCheckpointIsLate, type CompactSample, type CompactTrackingRow } from '../src/services/compactAlertOutcomes.js';
const samples = (prices: (number|null)[]): CompactSample[] => prices.map(price=>({status:price==null?'UNAVAILABLE':'MEASURED',price,mc:null,liquidity:null,at:'2026-10-02T00:00:00Z'}));
test('only sustained complete sampled performance qualifies as a winner',()=>{
 assert.equal(classifyCompactOutcome(100,samples([110,120,125])),'WINNER');
 assert.equal(classifyCompactOutcome(100,samples([60,110,130])),'NEUTRAL');
 assert.equal(classifyCompactOutcome(100,samples([300,20,10])),'FAILED');
 assert.equal(classifyCompactOutcome(100,samples([null,120,130])),'INCOMPLETE');
 assert.equal(classifyCompactOutcome(100,samples([0,120,130])),'INCOMPLETE');
 assert.equal(classifyCompactOutcome(100,samples([100,100,100])),'NEUTRAL');
});
test('outcomes never switch chain, token or pool to obtain a price',()=>{
 const row={chain:'arc',token:'0xAB',pair_id:'0xCD'};
 const correct={chainId:'arc',baseToken:{address:'0xab'},pairAddress:'0xcd',priceUsd:'1'};
 assert.equal(selectCompactPair([{...correct,chainId:'robinhood'},{...correct,pairAddress:'0xef'},correct],row),correct);
 assert.equal(selectCompactPair([{...correct,baseToken:{address:'0xaa'}}],row),null);
 assert.equal(selectCompactPair([{chainId:'solana',baseToken:{address:'Token'},pairAddress:'Pool'}],{chain:'solana',token:'Token',pair_id:'pool'}),null);
});
test('late checkpoints remain missing instead of backfilling with a later price',()=>{
 const row={started_at:'2026-10-02T00:00:00Z',checkpoint:0} as CompactTrackingRow;
 assert.equal(compactCheckpointIsLate(row,Date.parse('2026-10-02T00:19:00Z')),false);
 assert.equal(compactCheckpointIsLate(row,Date.parse('2026-10-02T00:21:00Z')),true);
});

test('shadow status is prospective, USD only, and requires comparable price and liquidity', async () => {
 const { compactShadowStatus } = await import('../src/services/compactAlertOutcomes.js');
 const r = {chain:'robinhood',token:'0x'+'a'.repeat(40),feed:'BOOST',pair_id:'0x'+'b'.repeat(40),
  price_unit:'USD',baseline_price:1,baseline_liquidity:10000,started_at:'2026-10-09T06:00:00Z',checkpoint:0,retried:false,lease:'test'};
 const s = {status:'MEASURED' as const,price:1.2,mc:10000,liquidity:11000,at:'2026-10-09T06:15:00Z'};
 assert.equal(compactShadowStatus(r,s),'STRENGTHENING');
 assert.equal(compactShadowStatus(r,{...s,price:.4}),'DETERIORATING');
 assert.equal(compactShadowStatus(r,{...s,liquidity:4000}),'DETERIORATING');
 for(const bad of [{...r,price_unit:'ETH_RESERVE_RATIO'},{...r,baseline_liquidity:null},{...r,started_at:'bad'}])
  assert.equal(compactShadowStatus(bad,s),'UNCONFIRMED');
 for(const bad of [{...s,status:'UNAVAILABLE' as const},{...s,liquidity:null},{...s,at:r.started_at}])
  assert.equal(compactShadowStatus(r,bad),'UNCONFIRMED');
});

test('checkpoint RPC projection obeys the deployed strict SQL contract and excludes shadow/presentation fields', async () => {
 const {compactStoredSample}=await import('../src/services/compactAlertOutcomes.js');
 const {readFileSync}=await import('node:fs');
 const sql=readFileSync(new URL('../supabase/migrations/20261002190839_compact_outcome_sample_validation.sql',import.meta.url),'utf8');
 const whitelist=sql.match(/where k not in \(([^)]+)\)/)?.[1].match(/'([^']+)'/g)?.map(s=>s.slice(1,-1)) ?? [];
 assert.equal(whitelist.length,6);
 const sample={status:'MEASURED' as const,price:1,mc:10000,liquidity:5000,at:'2026-10-09T06:00:00Z',
  shadow:'STRENGTHENING' as const,name:'presentation',symbol:'TOK',unexpected:'future metadata'};
 assert.deepEqual(Object.keys(compactStoredSample(sample)).sort(),['at','liquidity','mc','price','status']);
 assert.ok(Object.keys(compactStoredSample(sample)).every(key=>whitelist.includes(key)));
 assert.doesNotMatch(JSON.stringify(compactStoredSample(sample)),/shadow|presentation|unexpected|STRENGTHENING/);
 const unavailable={...sample,status:'UNAVAILABLE' as const,price:null,reason:'PROVIDER_UNAVAILABLE'};
 assert.deepEqual(Object.keys(compactStoredSample(unavailable)).sort(),['at','liquidity','mc','price','reason','status']);
 assert.equal(compactStoredSample(unavailable).reason,'PROVIDER_UNAVAILABLE');
});
