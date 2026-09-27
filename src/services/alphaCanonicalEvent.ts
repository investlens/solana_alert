export const ALPHA_CANONICAL_EVENT_TYPES = [
  'DEX_PAID',
  'BOOST_DETECTED',
  'BOOST_INCREASED',
  'MAX_BOOST_500_PLUS',
  'PONS_TREND_REVERSAL',
  'ROBINCHAIN_OPPORTUNITY',
  'ARC_TREND_REVERSAL',
  'ARC_BOOST',
  'VOLUME_SURGE',
  'BUILDING',
  'CONFIRMED',
  'RUNNER',
  'COOLING',
  'WEAKENING',
  'DANGER',
  'DEV_MOVEMENT',
  'DEV_TRANSFER',
  'DEV_SELL',
  'VERIFIED_BURN',
  'LIQUIDITY_REMOVAL',
  'LIQUIDITY_RISK',
  'SMART_MONEY_ENTRY',
  'SMART_MONEY_EXIT',
  'MULTI_SMART_MONEY',
  'WALLET_CLUSTER',
  'HOLDER_ACCUMULATION',
  'HOLDER_DISTRIBUTION',
  'RISK_EXIT_ALERT',
  'ALPHA_CONVERGENCE',
  'RUNNER_50',
  'RUNNER_100',
  'ATH_OBSERVATION',
  'NEW_ATH',
  'X_REPUTED_MENTION',
  'PONS_PROVEN_DEV_LAUNCH',
] as const;

export type AlphaCanonicalEventType = typeof ALPHA_CANONICAL_EVENT_TYPES[number];

// Legacy event names remain readable while producers are migrated incrementally.
// This prevents a big-bang deploy and lets us reuse the same event/delivery path.
export type AlphaLegacySemanticEventType = 'BOOST' | 'DEV_BURN';
export type AlphaSemanticEventType = AlphaCanonicalEventType | AlphaLegacySemanticEventType;

export const POSITIVE_CANONICAL_EVENTS = new Set<AlphaCanonicalEventType>([
  'DEX_PAID',
  'BOOST_DETECTED',
  'BOOST_INCREASED',
  'MAX_BOOST_500_PLUS',
  'PONS_TREND_REVERSAL',
  'ROBINCHAIN_OPPORTUNITY',
  'ARC_TREND_REVERSAL',
  'ARC_BOOST',
  'VOLUME_SURGE',
  'BUILDING',
  'CONFIRMED',
  'RUNNER',
  'VERIFIED_BURN',
  'SMART_MONEY_ENTRY',
  'MULTI_SMART_MONEY',
  'HOLDER_ACCUMULATION',
  'ALPHA_CONVERGENCE',
  'RUNNER_50',
  'RUNNER_100',
  'NEW_ATH',
  'X_REPUTED_MENTION',
  'PONS_PROVEN_DEV_LAUNCH',
]);

export const RISK_CANONICAL_EVENTS = new Set<AlphaCanonicalEventType>([
  'DANGER',
  'DEV_MOVEMENT',
  'DEV_TRANSFER',
  'DEV_SELL',
  'LIQUIDITY_REMOVAL',
  'LIQUIDITY_RISK',
  'SMART_MONEY_EXIT',
  'HOLDER_DISTRIBUTION',
  'RISK_EXIT_ALERT',
]);

export function canonicalizeAlphaEventType(type: AlphaSemanticEventType): AlphaCanonicalEventType {
  if (type === 'BOOST') return 'BOOST_DETECTED';
  if (type === 'DEV_BURN') return 'VERIFIED_BURN';
  return type;
}

export function canonicalAlphaEventLabel(type: AlphaSemanticEventType): string {
  switch (canonicalizeAlphaEventType(type)) {
    case 'BOOST_DETECTED': return 'BOOST DETECTED';
    case 'BOOST_INCREASED': return 'BOOST INCREASED';
    case 'MAX_BOOST_500_PLUS': return 'MAX BOOST 500+';
    case 'PONS_TREND_REVERSAL': return 'PONS TREND REVERSAL';
    case 'ROBINCHAIN_OPPORTUNITY': return 'ROBINCHAIN OPPORTUNITY';
    case 'ARC_TREND_REVERSAL': return 'ARC TREND REVERSAL';
    case 'ARC_BOOST': return 'ARC BOOST';
    case 'DEV_MOVEMENT': return 'DEV MOVEMENT';
    case 'DEV_SELL': return 'DEV SELL';
    case 'VERIFIED_BURN': return 'VERIFIED BURN';
    case 'LIQUIDITY_REMOVAL': return 'LIQUIDITY REMOVAL';
    case 'LIQUIDITY_RISK': return 'LIQUIDITY RISK';
    case 'SMART_MONEY_ENTRY': return 'SMART MONEY ENTRY';
    case 'SMART_MONEY_EXIT': return 'SMART MONEY EXIT';
    case 'MULTI_SMART_MONEY': return 'MULTI SMART MONEY';
    case 'HOLDER_ACCUMULATION': return 'HOLDER ACCUMULATION';
    case 'HOLDER_DISTRIBUTION': return 'HOLDER DISTRIBUTION';
    case 'RISK_EXIT_ALERT': return 'RISK EXIT ALERT';
    case 'ALPHA_CONVERGENCE': return 'ALPHA CONVERGENCE';
    default: return canonicalizeAlphaEventType(type).replaceAll('_', ' ');
  }
}
