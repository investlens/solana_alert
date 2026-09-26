import type { ArcMarketEnrichment } from './market.js';
import { evaluateArcSecurity, type ArcSecurityDecision } from './security.js';

export type ArcAlertAssessment = {
  alertable: false;
  security: ArcSecurityDecision;
  status: 'BLOCKED_SECURITY_ENRICHMENT_INCOMPLETE';
};

/**
 * Deliberately fail-closed. Market activity alone can never produce an Arc alert.
 * Holder concentration, deployer ownership/history, liquidity protection,
 * sell simulation and an external risk verdict must all be populated by verified
 * collectors before this gate can ever become alertable.
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
  return { alertable: false, security, status: 'BLOCKED_SECURITY_ENRICHMENT_INCOMPLETE' };
}
