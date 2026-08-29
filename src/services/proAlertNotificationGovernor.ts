import type { AlertComparison } from './alertComparisonService.js';
import { DEFAULT_SUSTAINED_INTELLIGENCE_CONFIG } from '../intelligence/tokenIntelligenceState.js';

export const PRO_ALERT_REPEAT_PROTECTION_MS = 10 * 60 * 1000;
export type ProAlertIntent = 'ENTRY' | 'MOMENTUM_UPDATE' | 'RECOVERY_WATCH' | 'INTERNAL';
export type ProAlertDecision = { intent: ProAlertIntent; notify: boolean; reasons: string[]; factors: string[] };

const factorReasons = (comparison: AlertComparison): { factors: string[]; reasons: string[] } => {
  const factors: string[] = [], reasons: string[] = [];
  const progression = comparison.price?.changePct;
  if (progression != null && progression >= 5) {
    factors.push('PROGRESSION'); reasons.push(`Price advanced ${progression.toFixed(1)}% since previous alert`);
  }
  const volume = comparison.volume5m;
  if (volume && volume.previous > 0 && volume.current >= volume.previous * 1.5) {
    factors.push('VOLUME_ACCELERATION'); reasons.push(`5m volume accelerated ${(volume.current / volume.previous).toFixed(1)}×`);
  }
  const buys = comparison.participation;
  if (buys && buys.currentBuys >= 2 && buys.currentBuys >= buys.previousBuys * 1.5 && buys.currentBuys > buys.currentSells) {
    factors.push('PARTICIPATION'); reasons.push('Buying participation expanded');
  }
  const liquidity = comparison.liquidity;
  if (liquidity && liquidity.changePct > DEFAULT_SUSTAINED_INTELLIGENCE_CONFIG.liquidityStableTolerance * 100) {
    factors.push('LIQUIDITY'); reasons.push('Liquidity improved materially');
  }
  const healthyTransition = comparison.previousState !== comparison.currentState &&
    ['CONFIRMED', 'RUNNER'].includes(String(comparison.currentState ?? '').toUpperCase()) &&
    !['COOLING', 'WEAKENING'].includes(String(comparison.previousState ?? '').toUpperCase());
  if (healthyTransition && factors.length > 0) {
    factors.push('STRUCTURAL_CONFIRMATION'); reasons.push('Healthy structure remained confirmed');
  }
  return { factors: [...new Set(factors)], reasons: reasons.slice(0, 3) };
};

export function evaluateProAlertNotification(comparison: AlertComparison): ProAlertDecision {
  if (comparison.historyStatus === 'UNAVAILABLE') {
    return { intent: 'INTERNAL', notify: false, reasons: [], factors: [] };
  }
  const evidence = factorReasons(comparison);
  const drawdown = comparison.drawdownFromPriorStructuralPricePct;
  const severelyDamaged = drawdown != null && drawdown <= -85;
  const damaged = drawdown != null && drawdown <= -50;
  if (!comparison.hasPriorAlert) {
    if (severelyDamaged) return { intent: 'INTERNAL', notify: false, ...evidence };
    return { intent: 'ENTRY', notify: true, reasons: [], factors: [] };
  }
  if ((comparison.elapsedSincePriorMs ?? 0) < PRO_ALERT_REPEAT_PROTECTION_MS) {
    return { intent: 'INTERNAL', notify: false, ...evidence };
  }
  if (damaged) return { intent: 'INTERNAL', notify: false, ...evidence };
  if (comparison.price && comparison.price.changePct >= 10) {
    return { intent: 'MOMENTUM_UPDATE', notify: true, ...evidence };
  }
  const supportingFactors = evidence.factors.filter(factor => factor !== 'PROGRESSION');
  const hasAccelerationSupport = supportingFactors.includes('VOLUME_ACCELERATION') || supportingFactors.includes('PARTICIPATION');
  return comparison.price != null && comparison.price.changePct >= 5 && supportingFactors.length >= 2 && hasAccelerationSupport
    ? { intent: 'MOMENTUM_UPDATE', notify: true, ...evidence }
    : { intent: 'INTERNAL', notify: false, ...evidence };
}
