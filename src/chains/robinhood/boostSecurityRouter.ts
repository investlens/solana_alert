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
  sellabilityVerified?: boolean;
};

type CachedGate = { expiresAt: number; value: BoostSecurityGateDecision };
const cache = new Map<string, CachedGate>();
const SAFE_TTL_MS = 30_000;
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

async function fetchCustomLiquidityProtection(tokenAddress: string, requireExplicitSellability = false, allowUnknownSellability = false): Promise<BoostLiquidityDecision> {
  const url = `https://api.gopluslabs.io/api/v1/token_security/4663?contract_addresses=${encodeURIComponent(tokenAddress)}`;
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return { allowed: allowUnknownSellability, status: 'UNKNOWN', reason: `Sellability and LP protection unverified (provider HTTP ${response.status}). Validate liquidity and selling before buying.` };
    const payload = await response.json() as { result?: Record<string, Record<string, unknown>> };
    const key = normalize(tokenAddress);
    const result = payload.result ?? {};
    const security = result[key] ?? result[Object.keys(result).find(v => normalize(v) === key) ?? ''];
    if (!security) return { allowed: allowUnknownSellability, status: 'UNKNOWN', reason: 'Sellability and LP protection unverified: provider data unavailable. Validate liquidity and selling before buying.' };

    // Hard safety failures remain non-negotiable. A BOOST never overrides
    // honeypot or sell-restriction evidence.
    if (String(security.is_honeypot ?? '0') === '1') return {
      allowed: false,
      status: 'UNLOCKED',
      reason: 'HARD BLOCK: honeypot flag; token may be buyable but not safely sellable',
    };
    if (String(security.cannot_sell_all ?? '0') === '1') return {
      allowed: false,
      status: 'UNLOCKED',
      reason: 'HARD BLOCK: sell restriction flag; holders may be unable to exit',
    };
    if (requireExplicitSellability && (String(security.is_honeypot) !== '0' || String(security.cannot_sell_all) !== '0'))
      return {allowed:allowUnknownSellability,status:'UNKNOWN',reason:'Sellability unverified: honeypot/sell-restriction evidence incomplete. Validate selling before investing.'};

    const holders = Array.isArray(security.lp_holders) ? security.lp_holders as Record<string, unknown>[] : [];
    if (!holders.length) return { allowed: true, status: 'UNKNOWN', reason: 'Sellability checks passed · LP protection unverified; liquidity may be removable. Validate before investing.' };

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
      reason: `LP PROTECTED: ${(protectedPct * 100).toFixed(1)}% of observed LP locked/burned`,
    };

    // Unlocked liquidity is a disclosed market risk, not automatically a
    // malicious contract. Allow the BOOST to surface with an explicit warning
    // after the hard honeypot/sellability checks above have passed.
    return {
      allowed: true,
      status: 'UNLOCKED',
      reason: `⚠️ HIGH RISK — LP UNLOCKED: only ${(protectedPct * 100).toFixed(1)}% protected; ${(unlockedPct * 100).toFixed(1)}% remains removable by LP holders. Sellability checks passed, but liquidity can be pulled. DYOR.`,
    };
  } catch (error) {
    // BOOST remains fail-closed; DEX payments can disclose unknown evidence. We only warn-and-allow BOOST when we
    // positively know the token passed hard sellability/honeypot checks and
    // the remaining issue is unlocked LP.
    return { allowed: allowUnknownSellability, status: 'UNKNOWN', reason: 'Sellability and LP protection unverified: provider check failed. Validate liquidity and selling before buying.' };
  }
}

/**
 * Fast route for a factory-verified trusted launchpad; hard security route otherwise.
 * BOOST blocks unknown security; DEX Paid may explicitly request warning-only unknown evidence.
 * Unlocked LP is allowed only as a prominently disclosed high-risk BOOST.
 * The custom check is cached so repeated BOOST increments do not repeatedly hit providers.
 */
export async function routeBoostSecurity(args: {
  tokenAddress: string;
  verifiedTrustedLaunchpad: boolean;
  requireExplicitSellability?: boolean;
  allowUnknownSellability?: boolean;
}): Promise<BoostSecurityGateDecision> {
  if (args.verifiedTrustedLaunchpad) return {
    allowed: true,
    route: 'TRUSTED_LAUNCHPAD',
    liquidity: null,
    reason: 'verified approved launchpad origin; separate security screening bypassed by policy, market risks remain',
    cached: false,
  };

  const key = normalize(args.tokenAddress) + (args.requireExplicitSellability ? ':explicit-sellability' : '') + (args.allowUnknownSellability ? ':dex-warn-unknown' : '');
  const now = Date.now();
  const prior = cache.get(key);
  if (prior && prior.expiresAt > now) return { ...prior.value, cached: true };

  const liquidity = await fetchCustomLiquidityProtection(args.tokenAddress, args.requireExplicitSellability, args.allowUnknownSellability);
  const warning = liquidity.allowed && liquidity.status === 'UNLOCKED';
  const value: BoostSecurityGateDecision = {
    allowed: liquidity.allowed,
    route: 'CUSTOM_SECURITY_REQUIRED',
    liquidity,
    reason: liquidity.allowed
      ? warning
        ? `custom security warning: ${liquidity.reason}`
        : `custom security ${liquidity.status === 'UNKNOWN' ? 'warning' : 'passed'}: ${liquidity.reason}`
      : `custom security blocked: ${liquidity.reason}`,
    cached: false,
    sellabilityVerified: liquidity.allowed && /Sellability checks passed|LP PROTECTED|LP UNLOCKED/.test(liquidity.reason),
  };
  if (cache.size >= 200 && !cache.has(key)) cache.delete(cache.keys().next().value!);
  cache.set(key, { expiresAt: now + (value.allowed ? SAFE_TTL_MS : BLOCKED_TTL_MS), value });
  return value;
}

export function clearBoostSecurityRouterCacheForTests(): void { cache.clear(); }
