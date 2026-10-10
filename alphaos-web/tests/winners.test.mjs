import test from 'node:test';
import assert from 'node:assert/strict';
import { verifiedWinners } from '../lib/dashboard/winners.ts';
const now=Date.parse('2026-10-10T12:00:00Z');
const event={id:1,chain:'robinhood',asset_id:'0xabc',symbol:'TEST',semantic_event_type:'BOOST',alerted_at:'2026-10-10T08:00:00Z',price:1};
const track={chain:'robinhood',token:'0xABC',feed:'BOOST',price_unit:'USD',baseline_price:1,started_at:event.alerted_at,samples:[{status:'MEASURED',at:'2026-10-10T09:00:00Z',price:5},{status:'MEASURED',at:'2026-10-10T10:00:00Z',price:.4}]};
test('show peak winner and later loss together, recomputing ratios',()=>{const [w]=verifiedWinners([event],[track],[],now);assert.equal(w.multiple,5);assert.equal(w.latestMultiple,.4);assert.equal(w.drawdown,-92);});
test('reject wrong currency, wrong feed, conflicting baseline and unmeasured prices',()=>{
 for(const t of [{...track,price_unit:'ETH/token'},{...track,feed:'DEX_PAID'},{...track,baseline_price:2},{...track,baseline_price:0},{...track,samples:[{status:'PENDING',at:'2026-10-10T09:00:00Z',price:5}]}])assert.equal(verifiedWinners([event],[t],[],now).length,0);
});
test('reject future, pre-alert and sub-2x samples',()=>{
 for(const samples of [[{status:'MEASURED',at:'2026-10-11T09:00:00Z',price:5}],[{status:'MEASURED',at:'2026-10-10T07:00:00Z',price:5}],[{status:'MEASURED',at:'2026-10-10T09:00:00Z',price:1.99}]])assert.equal(verifiedWinners([event],[{...track,samples}],[],now).length,0);
});
test('deduplicate token and reject ambiguous tracking registration',()=>{
 assert.equal(verifiedWinners([event,event],[track],[],now).length,1);
 assert.equal(verifiedWinners([event],[track,track],[],now).length,0);
});
