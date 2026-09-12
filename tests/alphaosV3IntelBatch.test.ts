import assert from 'node:assert/strict';
import test from 'node:test';
import { alphaOsIntelligenceUrl } from '../src/ui/alphaOsWebLink.js';
import { ALPHA_OUTCOME_CHECKPOINTS } from '../src/services/alphaAlertOutcomeCheckpoints.js';

test('AlphaOS V3 deep-links directly to exact token intelligence', () => {
  const token = '0x9095D8905DEA4C61527fC415138801c5029c573c';
  assert.match(alphaOsIntelligenceUrl(token), new RegExp(`/intelligence/${token}$`));
});

test('AlphaOS V3 retains measured outcomes through seven days', () => {
  for (const checkpoint of [10_800, 21_600, 43_200, 86_400, 259_200, 604_800]) {
    assert(ALPHA_OUTCOME_CHECKPOINTS.includes(checkpoint as (typeof ALPHA_OUTCOME_CHECKPOINTS)[number]));
  }
});
