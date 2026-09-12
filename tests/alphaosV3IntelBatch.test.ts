import { describe, expect, it } from 'vitest';
import { alphaOsIntelligenceUrl } from '../src/ui/alphaOsWebLink.js';
import { ALPHA_OUTCOME_CHECKPOINTS } from '../src/services/alphaAlertOutcomeCheckpoints.js';

describe('AlphaOS V3 intelligence batch', () => {
  it('deep-links directly to exact token intelligence', () => {
    const token = '0x9095D8905DEA4C61527fC415138801c5029c573c';
    expect(alphaOsIntelligenceUrl(token)).toContain(`/intelligence/${token}`);
  });

  it('retains measured outcomes through seven days', () => {
    expect(ALPHA_OUTCOME_CHECKPOINTS).toContain(10_800);
    expect(ALPHA_OUTCOME_CHECKPOINTS).toContain(86_400);
    expect(ALPHA_OUTCOME_CHECKPOINTS).toContain(259_200);
    expect(ALPHA_OUTCOME_CHECKPOINTS).toContain(604_800);
  });
});
