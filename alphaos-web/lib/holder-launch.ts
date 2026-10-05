type Environment = Record<string, string | undefined>;

// Public launch metadata only. A contract address never enables entitlements.
// Secure account linking and holder verification must be implemented separately.
export function getHolderLaunchConfig(env: Environment = process.env) {
  const candidate = env.ALPHAOS_TOKEN_ADDRESS?.trim() ?? '';
  const contract = /^0x[0-9a-fA-F]{40}$/.test(candidate) && !/^0x0{40}$/i.test(candidate) ? candidate : null;
  return {
    chain: 'robinhood' as const,
    chainLabel: 'Robinchain',
    contract,
    minimumTokens: 1_000_000,
    membership: 'Holder Pro',
    thresholdStatus: 'Proposed — final terms before activation',
    verificationEnabled: false as const,
    status: contract ? 'CONTRACT_PUBLISHED_VERIFICATION_PENDING' : 'LAUNCHING_SOON',
  };
}
