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
