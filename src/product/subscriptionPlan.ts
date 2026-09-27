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

export function publicSubscriptionStatusText(): string {
  return subscriptionsEnabled()
    ? 'Pro membership is available.'
    : 'Pro membership is being prepared while AlphaOS completes production validation.';
}
