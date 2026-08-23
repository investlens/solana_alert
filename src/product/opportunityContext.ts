import { normalizeNotificationMarketContext } from '../ui/notificationMarketContext.js';

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
 */
export function mergePonsLifecycleContext(
  existing: RawContext,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const priorIdentity = verifiedIdentity(existing);
  const incomingIdentity = normalizeNotificationMarketContext(incoming);
  const symbol = incomingIdentity.symbol ?? priorIdentity.symbol;
  const name = incomingIdentity.name ?? priorIdentity.name;

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
  };
}
