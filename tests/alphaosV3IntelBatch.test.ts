import assert from 'node:assert/strict';
import test from 'node:test';
import { alphaOsIntelligenceUrl } from '../src/ui/alphaOsWebLink.js';
import { ALPHA_OUTCOME_CHECKPOINTS } from '../src/services/alphaAlertOutcomeCheckpoints.js';

test('AlphaOS V3 deep-links directly to exact token intelligence', () => {
  const token = '0x9095D8905DEA4C61527fC415138801c5029c573c';
  assert.match(alphaOsIntelligenceUrl(token), new RegExp(`/intelligence/${token}$`));
});

test('AlphaOS V3 preserves the proven production outcome checkpoints', () => {
  assert.deepEqual([...ALPHA_OUTCOME_CHECKPOINTS], [30, 60, 180, 300, 900, 1800, 3600]);
});
