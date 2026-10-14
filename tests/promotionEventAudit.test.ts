import test from 'node:test';import assert from 'node:assert/strict';
import {createPromotionEventAudit} from '../src/services/promotionEventAudit.js';
import {renderFeedHealth} from '../src/services/feedDeliveryHealth.js';
test('unique purchase audit retains independent outcomes and never downgrades confirmed delivery',()=>{
 const audit=createPromotionEventAudit(3,10000,1000);
 audit.record('RH_BOOST','token:30','OBSERVED',1000);audit.record('RH_BOOST','token:30','WATCHED',1100);
 audit.record('RH_BOOST','token:60','DELIVERY_PENDING',1200);audit.record('RH_BOOST','token:60','DELIVERED',1300);
 audit.record('RH_BOOST','token:60','OBSERVED',1400);audit.record('RH_BOOST','token:60','DELIVERY_PENDING',1500);
 const snapshot=audit.snapshot(1500);assert.equal(snapshot.entries.length,2);assert.deepEqual(snapshot.entries.map(r=>r.stage),['WATCHED','DELIVERED']);
 assert.equal(snapshot.entries[0].firstAt,1000);assert.equal(snapshot.entries[1].updatedAt,1300);
 assert.doesNotMatch(JSON.stringify(snapshot),/token:|telegram/);
 const text=renderFeedHealth([{name:'Main',snapshot:{startedAt:1000,observedAt:1500,feeds:{},promotions:snapshot}}],1500);
 assert.match(text,/unique observed events: 2 · delivered 1 · watched 1/);
});
test('audit bounds, expiry and copies make omissions explicit without inventing successes',()=>{
 const audit=createPromotionEventAudit(2,1000,1000);audit.record('RH_DEX_PAID','a','WATCHED',1000);audit.record('RH_DEX_PAID','b','DELIVERY_PENDING',1100);audit.record('RH_DEX_PAID','c','BLOCKED',1200);
 const snapshot=audit.snapshot(1300);assert.equal(snapshot.capacityEvicted,1);assert.equal(snapshot.entries.length,2);snapshot.entries[0].stage='DELIVERED';assert.equal(audit.snapshot(1300).entries[0].stage,'DELIVERY_PENDING');
 assert.equal(audit.snapshot(2500).entries.length,0);assert.equal(audit.snapshot(2500).expired,2);
 assert.equal(audit.record('user-id','a','DELIVERED',2500),false);assert.equal(audit.record('RH_BOOST','a','DELIVERED',900),false);
});
