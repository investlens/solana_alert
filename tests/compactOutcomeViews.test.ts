import test from 'node:test';
import assert from 'node:assert/strict';
import {renderCompactTokenView,renderCompactCreatorView,renderCompactFeedView,validOutcomeAddress,type OutcomeSession} from '../src/services/compactOutcomeViews.js';
const token='0x'+'a'.repeat(40);
test('tracking distinguishes no record, provider failure and pending checkpoints',()=>{
 assert.match(renderCompactTokenView('arc',token,{state:'ready',value:null}),/No compact tracking record/);
 assert.match(renderCompactTokenView('arc',token,{state:'unavailable',value:null}),/temporarily unavailable/);
 const row:OutcomeSession={chain:'arc',token,feed:'BOOST',price_unit:'USD',baseline_price:100,samples:[{status:'MEASURED',price:120,at:'2026-10-02T19:00:00Z'},{status:'UNAVAILABLE',price:null}],due_at:'2026-10-03T01:00:00Z'};
 const text=renderCompactTokenView('arc',token,{state:'ready',value:row});
 assert.match(text,/\+20\.0%/);assert.match(text,/1h  Data unavailable/);assert.match(text,/6h  Pending/);assert.doesNotMatch(text,/\-100\.0%/);
 assert.match(text,/Not ATH or trade profit/);
});
test('creator totals include losses and exclude missing samples from winner share',()=>{
 const text=renderCompactCreatorView('robinhood',token,{state:'ready',value:{assessed_sessions:5,winners:1,failed:1,neutral:1,incomplete:2,last_assessed_at:'2026-10-02T19:00:00Z'}});
 assert.match(text,/33\.3%.*3 complete sessions/);assert.match(text,/Incomplete  2/);assert.match(text,/not total launches/);
 assert.match(renderCompactCreatorView('arc',token,{state:'ready',value:null}),/does not mean.*no prior launches/);
});
test('feed report includes negative results, pending and bounded coverage rather than winner-only proof',()=>{
 const text=renderCompactFeedView({state:'ready',value:[{day:'2026-10-02',chain:'arc',feed:'<BOOST>',tracked:7,winners:1,failed:2,neutral:1,incomplete:1,excluded:4}]});
 assert.match(text,/Winners 1 · Failed 2 · Other 1/);assert.match(text,/Pending 2/);assert.match(text,/Excluded admissions 4/);assert.match(text,/&lt;BOOST&gt;/);assert.match(text,/best effort/);
 assert.match(renderCompactFeedView({state:'ready',value:[]}),/No assessed outcomes yet/);
});
test('other price outcomes disclose losses and thin liquidity rather than imply neutrality',()=>{
 const row:OutcomeSession={chain:'robinhood',token,feed:'BOOST',price_unit:'USD',baseline_price:100,baseline_liquidity:10000,outcome:'NEUTRAL',samples:[{status:'MEASURED',price:65,liquidity:6500},{status:'MEASURED',price:80,liquidity:6000},{status:'MEASURED',price:51,liquidity:4.31}]};
 const text=renderCompactTokenView('robinhood',token,{state:'ready',value:row});
 assert.match(text,/OTHER · neither outcome threshold met/);assert.match(text,/-49\.0%/);
 assert.match(text,/below the alert baseline/);assert.match(text,/\$4\.31/);
 assert.match(text,/-100\.0%/);assert.match(text,/Quoted price may not be executable/);
 assert.doesNotMatch(text,/Status.*NEUTRAL/);
 const unavailable=renderCompactTokenView('arc',token,{state:'ready',value:{...row,samples:[{status:'UNAVAILABLE',price:null,liquidity:null}]}});
 assert.match(unavailable,/liquidity  Unavailable/);assert.doesNotMatch(unavailable,/\$0\.00|Thin or sharply/);
 const curve=renderCompactTokenView('robinhood',token,{state:'ready',value:{...row,price_unit:'ETH_RESERVE_RATIO'}});
 assert.doesNotMatch(curve,/sampled liquidity/);
});
test('address validation and output escape prevent cross-chain invalid lookups and HTML injection',()=>{
 assert.equal(validOutcomeAddress('arc',token),true);assert.equal(validOutcomeAddress('other',token),false);assert.equal(validOutcomeAddress('solana',token),false);
 const text=renderCompactTokenView('arc',token,{state:'ready',value:{chain:'arc',token,feed:'<script>',outcome:'WINNER',price_unit:'ETH_RESERVE_RATIO',baseline_price:1,samples:[{status:'MEASURED',price:1.3}]}});
 assert.match(text,/&lt;script&gt;/);assert.match(text,/Native ETH reserve ratio/);assert.ok(text.length<4096);
});
