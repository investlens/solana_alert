import assert from 'node:assert/strict';
import test from 'node:test';

import {
  coreDecisionEvidenceMetrics,
  normalizeCoreDecisionMetrics,
} from '../src/ui/notificationMarketContext.js';

test('core decision metrics render verified values including measured zero', () => {
  const measured = normalizeCoreDecisionMetrics({
    devHoldingPercent: 2.86, devHoldingEvidence: 'VERIFIED',
    totalBurnPercent: 12.4, burnEvidence: 'VERIFIED',
  });
  assert.deepEqual(coreDecisionEvidenceMetrics(measured), [
    { label: 'Dev holding', value: '2.86%' },
    { label: 'Burned', value: '12.4%' },
  ]);

  const zero = normalizeCoreDecisionMetrics({
    devHoldingPercent: 0, devHoldingStatus: 'ZERO',
    totalBurnPercent: 0, devFlowEvidenceStatus: 'BALANCES_ONLY',
  });
  assert.deepEqual(coreDecisionEvidenceMetrics(zero), [
    { label: 'Dev holding', value: '0%' },
    { label: 'Burned', value: '0%' },
  ]);
});

test('unknown and default-zero decision metrics are omitted', () => {
  const unknown = normalizeCoreDecisionMetrics({ devHoldingPercent: 0, totalBurnPercent: 0 });
  assert.deepEqual(coreDecisionEvidenceMetrics(unknown), []);
  const absent = normalizeCoreDecisionMetrics({ devHoldingPercent: null, totalBurnPercent: null });
  assert.deepEqual(coreDecisionEvidenceMetrics(absent), []);
});

test('burn destinations recognize only supported zero and dead addresses', async () => {
  await import('dotenv/config');
  const { classifyDevTransferDestination } = await import('../src/chains/robinhood/security/devTokenFlowScanner.js');
  assert.equal(classifyDevTransferDestination('0x0000000000000000000000000000000000000000'), 'BURN');
  assert.equal(classifyDevTransferDestination('0x000000000000000000000000000000000000dEaD'), 'BURN');
  assert.equal(classifyDevTransferDestination('0x1111111111111111111111111111111111111111'), 'TRANSFER');
});
