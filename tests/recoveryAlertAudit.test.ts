import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecoveryAlertAudit, capturedOwnershipEvidence } from '../src/services/recoveryAlertAudit.js';
test('recovery audit records only accepted events and excludes payload, image and recipient identities', () => {
 const event = { id: -1, eventIdentity: 'boost:test', type: 'BOOST', assetId: '0xabc', chain: 'robinhood', rawSnapshot: { price: 0.01, marketCap: 10000, telegram_id: 'secret', image: 'bytes', hugePayload: 'x'.repeat(10000) } };
 assert.equal(buildRecoveryAlertAudit(event, 0), null);
 const row = buildRecoveryAlertAudit(event, 2)!;
 assert.equal(row.price, 0.01);assert.equal(row.market_cap,10000);
 assert.equal(row.raw_snapshot.acceptedRecipients, 2);
 assert.equal(row.raw_snapshot.performanceBaselineVerified, false);
 assert.doesNotMatch(JSON.stringify(row), /secret|hugePayload|bytes/);
 assert.ok(JSON.stringify(row).length < 1000);
});

test('ownership baseline preserves confirmed zero and rejects stale, incomplete or invalid observations', () => {
 const now = Date.parse('2026-10-09T06:00:00Z');
 const ownership = { creator: '0x'+'a'.repeat(40), devPercent: 0, devObservedAt: now-1000,
   devBlock: '80764517', top10Percent: null, top10Coverage: 'UNAVAILABLE' as const };
 assert.equal(capturedOwnershipEvidence(ownership, now)?.percent, 0);
 for(const patch of [{devPercent:101},{devPercent:NaN},{devObservedAt:now-60001},{devObservedAt:now+1},
   {devBlock:undefined},{creator:'bad'},{creator:'0x'+'0'.repeat(40)}])
  assert.equal(capturedOwnershipEvidence({...ownership,...patch}, now), null);
 const event = {id:-1,eventIdentity:'boost:verified',type:'BOOST',assetId:'0x'+'b'.repeat(40),chain:'robinhood'};
 // Fan-out may finish later; evaluate freshness when captured, not after recipient delays.
 const row = buildRecoveryAlertAudit(event, 1, new Date(now+90000), ownership, now)!;
 assert.equal(row.dev_holding_percent, 0);assert.equal(row.dev_holding_source, 'ON_CHAIN_BALANCE');
 assert.equal(row.creator_evidence?.address, ownership.creator);
 assert.match(row.dev_holding_evidence!, /80764517/);
});
