export type AlphaCommercialTier = 'free' | 'pro' | 'admin';

export const ALPHAOS_SUBSCRIPTION_PLAN = Object.freeze({
  publicTiers: ['free', 'pro'] as const,
  intro: Object.freeze({
    priceUsdEquivalent: 1,
    accessDays: 15,
  }),
  renewal: Object.freeze({
    priceUsdEquivalent: 49,
    accessDays: 30,
  }),
  deliveryDelaySeconds: Object.freeze({
    admin: 0,
    pro: 5,
    free: 30,
  }),
  paymentRail: 'ROBINHOOD_CHAIN_NATIVE_EQUIVALENT' as const,
});

export function subscriptionsEnabled(): boolean {
  return String(process.env.SUBSCRIPTIONS_ENABLED ?? 'false').toLowerCase() === 'true';
}

export function assertSubscriptionsEnabled(): void {
  if (!subscriptionsEnabled()) {
    throw new Error('AlphaOS paid subscriptions are not enabled yet. Core production validation is still in progress.');
  }
}

export function paidAccessIsCurrent(user: any, nowMs = Date.now()): boolean {
  if (String(user?.tier ?? '').toLowerCase() !== 'paid') return false;
  if (String(user?.subscription_status ?? '').toLowerCase() !== 'active') return false;

  const activeUntil = Date.parse(String(user?.paid_active_until ?? ''));
  return Number.isFinite(activeUntil) && activeUntil > nowMs;
}

export function deliveryDelayMsForTier(
  tier: AlphaCommercialTier,
  options: { safetyCritical?: boolean } = {},
): number {
  // During pre-subscription production validation every tester receives the
  // canonical event immediately. We only introduce tier delays once the
  // commercial gate is explicitly opened.
  if (!subscriptionsEnabled()) return 0;

  // Safety/risk warnings are never monetization-delayed.
  if (options.safetyCritical) return 0;

  return ALPHAOS_SUBSCRIPTION_PLAN.deliveryDelaySeconds[tier] * 1_000;
}

export function publicSubscriptionStatusText(): string {
  return subscriptionsEnabled()
    ? 'Pro access is enabled for existing members. New payment collection remains closed.'
    : 'Pro membership is being prepared while AlphaOS completes production validation.';
}

// The legacy SOL collector cannot activate the Robinchain commercial plan.
export function assertPaymentCollectionReady(): never {
  assertSubscriptionsEnabled();
  throw new Error('Payment collection is closed: the AlphaOS payment rail has not been validated.');
}
