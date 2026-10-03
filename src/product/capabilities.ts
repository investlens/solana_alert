import { paidAccessIsCurrent, subscriptionsEnabled } from './subscriptionPlan.js';

export type CommercialTier = 'free' | 'pro' | 'admin';

export type Capability =
  | 'opportunities.view'
  | 'opportunities.realtime'
  | 'trade.readiness'
  | 'monitoring.personal'
  | 'watchlist.use'
  | 'intelligence.investigations'
  | 'intelligence.smartMoney'
  | 'intelligence.creators'
  | 'intelligence.performance'
  | 'wallets.track'
  | 'wallets.activity'
  | 'trading.external'
  | 'trading.admin'
  | 'strategies.manage'
  | 'membership.manage';

const TESTER = new Set<Capability>([
  'trade.readiness',
  'monitoring.personal',
  'opportunities.view',
  'opportunities.realtime',
  'watchlist.use',
  'intelligence.investigations',
  'intelligence.smartMoney',
  'intelligence.creators',
  'intelligence.performance',
  'wallets.track',
  'wallets.activity',
  'trading.external',
  'strategies.manage',
  'membership.manage',
]);

const COMMERCIAL_FREE = new Set<Capability>([
  'opportunities.view',
  'intelligence.investigations',
  'trading.external',
  'strategies.manage',
  'membership.manage',
]);

const PRO = TESTER;

const ADMIN = new Set<Capability>([
  ...PRO,
  'trading.admin',
]);

export type AccessProfile = {
  tier: CommercialTier;
  label: string;
  capabilities: ReadonlySet<Capability>;
};

export function commercialTierForUser(user: any): CommercialTier {
  if (String(user?.tier ?? '').toLowerCase() === 'admin') return 'admin';

  // Before public subscriptions are launched, all non-admin users remain full
  // production testers. This keeps validation broad while the commercial gate
  // is deliberately closed.
  if (!subscriptionsEnabled()) return 'free';

  return paidAccessIsCurrent(user) ? 'pro' : 'free';
}

export function accessProfileForTier(tier: CommercialTier): AccessProfile {
  if (tier === 'admin') {
    return { tier, label: '👑 Admin', capabilities: ADMIN };
  }
  if (tier === 'pro') {
    return { tier, label: '⭐ Pro', capabilities: PRO };
  }
  return {
    tier,
    label: '⚪ Free',
    capabilities: subscriptionsEnabled() ? COMMERCIAL_FREE : TESTER,
  };
}

export function accessProfileForUser(user: any): AccessProfile {
  return accessProfileForTier(commercialTierForUser(user));
}

export function hasCapability(
  access: AccessProfile,
  capability: Capability,
): boolean {
  return access.capabilities.has(capability);
}

export const CAPABILITY_BENEFITS: Record<Capability, string> = {
  'trade.readiness': 'Review fresh market screening and remaining entry checks.',
  'monitoring.personal': 'Follow selected Robinchain pools with bounded one-hour deterioration monitoring.',
  'opportunities.view': 'Explore current market opportunities.',
  'opportunities.realtime': 'Receive faster actionable opportunity intelligence.',
  'watchlist.use': 'Save opportunities and follow their current thesis.',
  'intelligence.investigations': 'Review AlphaOS market investigations.',
  'intelligence.smartMoney': 'See recent tracked smart-money activity.',
  'intelligence.creators': 'Review tracked creator history and reputation.',
  'intelligence.performance': 'Review measured AlphaOS outcomes.',
  'wallets.track': 'Track selected public wallets.',
  'wallets.activity': 'Review and receive tracked-wallet activity.',
  'trading.external': 'Open supported external market and trading routes.',
  'trading.admin': 'Use the private AlphaOS admin trading engine.',
  'strategies.manage': 'Choose which normal strategy alerts you receive.',
  'membership.manage': 'Review and manage AlphaOS membership.',
};
