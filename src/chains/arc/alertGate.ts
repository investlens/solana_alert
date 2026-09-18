import type { ArcMarketEnrichment } from './market.js';
import { evaluateArcSecurity, type ArcSecurityDecision } from './security.js';

export type ArcAlertAssessment = {
  alertable: boolean;
  security: ArcSecurityDecision;
  status: 'READY' | 'BLOCKED_SECURITY';
};

/**
 * Fail closed on facts that are known unsafe or on missing core market data.
 * Optional enrichment that is not yet available is surfaced as a warning and
 * must not globally disable the live feed.
 */
export function assessArcForAlert(token: ArcMarketEnrichment): ArcAlertAssessment {
  const security = evaluateArcSecurity({
    ...token,
    topHolderPct: null,
    deployerPct: null,
    liquidityLocked: null,
    sellSimulationPassed: null,
    externalRiskFlag: null,
  });

  return {
    alertable: security.allowAlert,
    security,
    status: security.allowAlert ? 'READY' : 'BLOCKED_SECURITY',
  };
}
