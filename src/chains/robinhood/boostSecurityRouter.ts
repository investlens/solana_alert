type LaunchSecurityRoute = 'TRUSTED_LAUNCHPAD' | 'CUSTOM_SECURITY_REQUIRED';

export type BoostLiquidityDecision = {
  allowed: boolean;
  status: 'LOCKED' | 'BURNED' | 'UNLOCKED' | 'UNKNOWN';
  reason: string;
};

export type BoostSecurityGateDecision = {
  allowed: boolean;
  route: LaunchSecurityRoute;
  liquidity: BoostLiquidityDecision | null;
  reason: string;
  cached: boolean;
};

type CachedGate = { expiresAt: number; value: BoostSecurityGateDecision };
const cache = new Map<string, CachedGate>();
const SAFE_TTL_MS = 5 * 60_000;
const BLOCKED_TTL_MS = 60_000;

function normalize(value: string): string { return value.trim().toLowerCase(); }
function numericPercent(value: unknown): number { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : 0; }
function burnLikeLpHolder(holder: Record<string, unknown>): boolean {
  const address = String(holder.address ?? holder.token_account ?? '').toLowerCase();
  const tag = String(holder.tag ?? '').toLowerCase();
  return address === '0x0000000000000000000000000000000000000000'
    || address === '0x000000000000000000000000000000000000dead'
    || tag.includes('burn') || tag.includes('dead') || tag.includes('null address') || tag.includes('black hole');
}

async function fetchCustomLiquidityProtection(tokenAddress: string): Promise<BoostLiquidityDecision> {
  const url = `https://api.gopluslabs.io/api/v1/token_security/4663?contract_addresses=${encodeURIComponent(tokenAddress)}`;
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return { allowed: false, status: 'UNKNOWN', reason: `GoPlus HTTP ${response.status}` };
    const payload = await response.json() as { result?: Record<string, Record<string, unknown>> };
    const key = normalize(tokenAddress);
    const result = payload.result ?? {};
    const security = result[key] ?? result[Object.keys(result).find(v => normalize(v) === key) ?? ''];
    if (!security) return { allowed: false, status: 'UNKNOWN', reason: 'security/LP data unavailable' };
    if (String(security.is_honeypot ?? '0') === '1') return { allowed: false, status: 'UNLOCKED', reason: 'honeypot flag' };
    if (String(security.cannot_sell_all ?? '0') === '1') return { allowed: false, status: 'UNLOCKED', reason: 'sell restriction flag' };

    const holders = Array.isArray(security.lp_holders) ? security.lp_holders as Record<string, unknown>[] : [];
    if (!holders.length) return { allowed: false, status: 'UNKNOWN', reason: 'no independently verified LP-holder evidence' };

    let protectedPct = 0, burnedPct = 0, unlockedPct = 0;
    for (const holder of holders) {
      const pct = numericPercent(holder.percent);
      const locked = String(holder.is_locked ?? '0') === '1';
      const burned = burnLikeLpHolder(holder);
      if (locked || burned) protectedPct += pct;
      if (burned) burnedPct += pct;
      if (!locked && !burned) unlockedPct += pct;
    }
    if (protectedPct >= 0.95) return {
      allowed: true,
      status: burnedPct >= 0.95 ? 'BURNED' : 'LOCKED',
      reason: `${(protectedPct * 100).toFixed(1)}% of observed LP protected`,
    };
    return {
      allowed: false,
      status: 'UNLOCKED',
      reason: `only ${(protectedPct * 100).toFixed(1)}% LP protected; ${(unlockedPct * 100).toFixed(1)}% remains removable`,
    };
  } catch (error) {
    return { allowed: false, status: 'UNKNOWN', reason: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180) };
  }
}

/**
 * Fast route for a factory-verified trusted launchpad; hard security route otherwise.
 * The custom check is cached so repeated BOOST increments do not repeatedly hit providers.
 */
export async function routeBoostSecurity(args: {
  tokenAddress: string;
  verifiedTrustedLaunchpad: boolean;
}): Promise<BoostSecurityGateDecision> {
  if (args.verifiedTrustedLaunchpad) return {
    allowed: true,
    route: 'TRUSTED_LAUNCHPAD',
    liquidity: null,
    reason: 'verified trusted launchpad origin; launchpad guarantees applied',
    cached: false,
  };

  const key = normalize(args.tokenAddress);
  const now = Date.now();
  const prior = cache.get(key);
  if (prior && prior.expiresAt > now) return { ...prior.value, cached: true };

  const liquidity = await fetchCustomLiquidityProtection(args.tokenAddress);
  const value: BoostSecurityGateDecision = {
    allowed: liquidity.allowed,
    route: 'CUSTOM_SECURITY_REQUIRED',
    liquidity,
    reason: liquidity.allowed ? `custom security passed: ${liquidity.reason}` : `custom security blocked: ${liquidity.reason}`,
    cached: false,
  };
  cache.set(key, { expiresAt: now + (value.allowed ? SAFE_TTL_MS : BLOCKED_TTL_MS), value });
  return value;
}

export function clearBoostSecurityRouterCacheForTests(): void { cache.clear(); }
