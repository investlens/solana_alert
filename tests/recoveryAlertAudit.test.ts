import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecoveryAlertAudit } from '../src/services/recoveryAlertAudit.js';
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
