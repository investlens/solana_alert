import { normalizeCoreDecisionMetrics, normalizeNotificationMarketContext } from '../ui/notificationMarketContext.js';

type RawContext = Record<string, unknown> | null | undefined;

function verifiedIdentity(raw: RawContext) {
  if (!raw) return { symbol: null, name: null };
  const context = normalizeNotificationMarketContext(raw);
  const verified = Boolean(
    raw.identityVerifiedAt ||
    raw.marketIndexState === 'NOT_INDEXED' ||
    raw.marketIndexState === 'VERIFIED',
  );
  return verified
    ? { symbol: context.symbol, name: context.name }
    : { symbol: null, name: null };
}

export function hasVerifiedOpportunityIdentity(raw: RawContext): boolean {
  const identity = verifiedIdentity(raw);
  return Boolean(identity.symbol || identity.name);
}

/*
 * Verified symbol/name are durable token identity and may cross strategies.
 * Market values are time-sensitive observations: their provenance is kept for
 * audit, but they are not copied into a later lifecycle payload as current.
 *
 * Developer holding/burn evidence is also time-sensitive. If a newer lifecycle
 * observation explicitly reports the metric as unavailable (null), do not carry
 * a previously verified percentage forward and present it as current evidence.
 */
export function mergePonsLifecycleContext(
  existing: RawContext,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const priorIdentity = verifiedIdentity(existing);
  const incomingIdentity = normalizeNotificationMarketContext(incoming);
  const symbol = incomingIdentity.symbol ?? priorIdentity.symbol;
  const name = incomingIdentity.name ?? priorIdentity.name;
  const priorEvidence = normalizeCoreDecisionMetrics(existing);
  const incomingEvidence = normalizeCoreDecisionMetrics(incoming);

  const incomingExplicitlyClearsHolding =
    Object.prototype.hasOwnProperty.call(incoming, 'devHoldingPercent') && incoming.devHoldingPercent == null;
  const incomingExplicitlyClearsBurn =
    ((Object.prototype.hasOwnProperty.call(incoming, 'totalBurnPercent') && incoming.totalBurnPercent == null) ||
      (Object.prototype.hasOwnProperty.call(incoming, 'burnedPercent') && incoming.burnedPercent == null));

  const devHoldingVerified = incomingEvidence.devHoldingEvidence === 'VERIFIED'
    ? incomingEvidence
    : !incomingExplicitlyClearsHolding && priorEvidence.devHoldingEvidence === 'VERIFIED'
      ? priorEvidence
      : null;
  const burnVerified = incomingEvidence.burnEvidence === 'VERIFIED'
    ? incomingEvidence
    : !incomingExplicitlyClearsBurn && priorEvidence.burnEvidence === 'VERIFIED'
      ? priorEvidence
      : null;
  const incomingValuation = incoming.preIndexValuation && typeof incoming.preIndexValuation === 'object'
    ? incoming.preIndexValuation
    : null;
  const priorValuation = existing?.preIndexValuation && typeof existing.preIndexValuation === 'object'
    ? existing.preIndexValuation
    : null;

  return {
    ...incoming,
    symbol,
    name,
    ...(symbol || name
      ? {
          identityVerifiedAt: incoming.identityVerifiedAt ?? existing?.identityVerifiedAt ?? new Date().toISOString(),
          identitySource: incoming.identitySource ?? existing?.identitySource ?? 'PONS_LIFECYCLE',
        }
      : {}),
    ...(existing?.verifiedMarketContext && !incoming.verifiedMarketContext
      ? { verifiedMarketContext: existing.verifiedMarketContext }
      : {}),
    ...((incomingValuation ?? priorValuation)
      ? { preIndexValuation: incomingValuation ?? priorValuation }
      : {}),
    ...(devHoldingVerified
      ? {
          devHoldingPercent: devHoldingVerified.devHoldingPercent,
          devHoldingEvidence: 'VERIFIED',
          devHoldingSource: incomingEvidence.devHoldingEvidence === 'VERIFIED'
            ? incoming.devHoldingSource
            : existing?.devHoldingSource,
          devHoldingObservedAt: incomingEvidence.devHoldingEvidence === 'VERIFIED'
            ? incoming.devHoldingObservedAt
            : existing?.devHoldingObservedAt,
        }
      : {}),
    ...(burnVerified
      ? {
          totalBurnPercent: burnVerified.burnedPercent,
          burnEvidence: 'VERIFIED',
          burnSource: incomingEvidence.burnEvidence === 'VERIFIED'
            ? incoming.burnSource
            : existing?.burnSource,
          burnObservedAt: incomingEvidence.burnEvidence === 'VERIFIED'
            ? incoming.burnObservedAt
            : existing?.burnObservedAt,
        }
      : {}),
  };
}
