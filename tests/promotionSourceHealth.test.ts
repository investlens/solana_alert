import test from 'node:test';import assert from 'node:assert/strict';
import {localFeedHealth,recordFeedPoll,renderFeedHealth} from '../src/services/feedDeliveryHealth.js';
test('quiet poll has fresh activity without inflating recipients or inventing events',()=>{
 const before=localFeedHealth();recordFeedPoll('RH_BOOST_SCAN','OK',0);const after=localFeedHealth();
 assert.deepEqual(after.feeds,before.feeds);assert.equal(after.polls?.RH_BOOST_SCAN.items,0);assert.equal(after.polls?.RH_BOOST_SCAN.status,'OK');
 const text=renderFeedHealth([{name:'Main',snapshot:after}]);assert.match(text,/RH BOOST SCAN: OK · 0 rows/);assert.match(text,/observations, not new purchases/);
 recordFeedPoll('RH_BOOST_SCAN','UNAVAILABLE');assert.match(renderFeedHealth([{name:'Main',snapshot:localFeedHealth()}]),/RH BOOST SCAN: UNAVAILABLE/);
 const frozen=localFeedHealth();frozen.polls!.RH_BOOST_SCAN.items=100;assert.equal(localFeedHealth().polls!.RH_BOOST_SCAN.items,0);
});
test('source diagnostics reject IDs and remain bounded; old snapshots remain supported',()=>{
 const before=localFeedHealth();recordFeedPoll('0x'+'a'.repeat(40),'OK',1);recordFeedPoll('INVALID_COUNT','OK',-1);assert.deepEqual(localFeedHealth(),before);
 for(let i=0;i<40;i++)recordFeedPoll('SOURCE_'+String.fromCharCode(65+i),'OK',0);
 assert.ok(Object.keys(localFeedHealth().polls??{}).length<=32);
 const now=Date.now();assert.match(renderFeedHealth([{name:'Old worker',snapshot:{startedAt:now,observedAt:now,feeds:{}}}],now),/No recipient attempts/);
 assert.match(renderFeedHealth([{name:'Stale source',snapshot:{startedAt:1,observedAt:now,feeds:{},polls:{RH_BOOST_SCAN:{observedAt:now-181000,status:'OK',items:0}}}}],now),/STALE/);
});
