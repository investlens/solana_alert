import {
  scanRobinhoodContractSecurity,
} from './contractScanner.js';

import type {
  RobinhoodContractSecurityResult,
} from './types.js';

export type RobinhoodSecurityGateResult = {
  allowed: boolean;

  requiresReview: boolean;

  security:
    RobinhoodContractSecurityResult;
};

export async function runRobinhoodSecurityGate(
  tokenAddress: string,
): Promise<RobinhoodSecurityGateResult> {
  const security =
    await scanRobinhoodContractSecurity(
      tokenAddress,
    );

  return {
    allowed:
      security.decision ===
      'PASS',

    requiresReview:
      security.decision ===
      'REVIEW',

    security,
  };
}
