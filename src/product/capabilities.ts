export type CommercialTier = 'free' | 'pro' | 'admin';

export type Capability =
  | 'opportunities.view'
  | 'opportunities.realtime'
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

const FREE = new Set<Capability>([
  'opportunities.view',
  'intelligence.investigations',
  'trading.external',
  'strategies.manage',
  'membership.manage',
]);

const PRO = new Set<Capability>([
  ...FREE,
  'opportunities.realtime',
  'watchlist.use',
  'intelligence.smartMoney',
  'intelligence.creators',
  'intelligence.performance',
  'wallets.track',
  'wallets.activity',
]);

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
  if (
    String(user?.tier ?? '').toLowerCase() === 'paid' &&
    String(user?.subscription_status ?? '').toLowerCase() === 'active'
  ) return 'pro';
  return 'free';
}

export function accessProfileForTier(tier: CommercialTier): AccessProfile {
  if (tier === 'admin') {
    return { tier, label: '👑 Admin', capabilities: ADMIN };
  }
  if (tier === 'pro') {
    return { tier, label: '⭐ Pro', capabilities: PRO };
  }
  return { tier, label: '⚪ Free', capabilities: FREE };
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
