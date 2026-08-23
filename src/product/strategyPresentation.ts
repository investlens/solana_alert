const STRATEGIES: Record<string, { name: string; description: string }> = {
  PONS_RISK: {
    name: 'PONS Risk Monitor',
    description: 'Material risk changes on monitored PONS tokens.',
  },
  PONS_BREAKOUT: {
    name: 'PONS Breakout',
    description: 'Qualified PONS momentum and breakout conditions.',
  },
  PONS_IGNITION: {
    name: 'PONS Ignition',
    description: 'Early PONS acceleration with supporting evidence.',
  },
  ALPHA_REENTRY: {
    name: 'Alpha Re-entry',
    description: 'A previously observed thesis regaining confirmation.',
  },
  SOL_MOMENTUM: {
    name: 'Solana Momentum',
    description: 'Qualified Solana momentum with market confirmation.',
  },
};

export function strategyDisplay(key?: string | null, fallback?: string | null) {
  const normalized = String(key ?? '').trim().toUpperCase();
  const known = STRATEGIES[normalized];
  if (known) return known;

  const name = String((fallback ?? normalized) || 'Market Monitor')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, letter => letter.toUpperCase());

  return {
    name,
    description: 'Market conditions monitored by AlphaOS.',
  };
}
