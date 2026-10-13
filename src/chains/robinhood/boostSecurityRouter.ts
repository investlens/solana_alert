import {verifyCustomTokenExit,customPoolRisk,observedLpStatus,type ExitRequest,type ExitVerification} from '../../services/customTokenExitVerification.js';
import { governedDexScreenerJson } from '../../services/dexscreenerRequestGovernor.js';
import { promotionAlertPolicy, reportedPromotionSells } from '../../security/promotionAlertPolicy.js';
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
  exitPairId?:string;
  exitUnverified?:boolean;
};

type CachedGate = { expiresAt: number; value: BoostSecurityGateDecision };
const cache = new Map<string, CachedGate>();
const evidenceCache=new Map<string,Record<string,unknown>>();
const SAFE_TTL_MS = 30_000;
const BLOCKED_TTL_MS = 60_000;

function normalize(value: string): string { return value.trim().toLowerCase(); }

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

    if(evidenceCache.size>=200)evidenceCache.delete(evidenceCache.keys().next().value!);
    evidenceCache.set(key,security);
    const poolRisk=customPoolRisk(security);if(poolRisk)return {allowed:false,status:'UNKNOWN',reason:poolRisk};

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

    const status=observedLpStatus(security);
    return {allowed:true,status,reason:`LP ${status}`};

  } catch (error) {
    // BOOST remains fail-closed; DEX payments can disclose unknown evidence. We only warn-and-allow BOOST when we
    // positively know the token passed hard sellability/honeypot checks and
    // the remaining issue is unlocked LP.
    return { allowed: allowUnknownSellability, status: 'UNKNOWN', reason: 'Sellability and LP protection unverified: provider check failed. Validate liquidity and selling before buying.' };
  }
}

/**
 * Fast route for a factory-verified trusted launchpad; hard security route otherwise.
 * Custom automatic alerts require actual same-wallet exit verification; legacy
 * allowUnknownSellability never overrides that check.
 * Unlocked LP is allowed only as a prominently disclosed high-risk BOOST.
 * The custom check is cached so repeated BOOST increments do not repeatedly hit providers.
 */
export async function routeBoostSecurity(args: {
  tokenAddress: string;
  pairId?: string;
  verifiedTrustedLaunchpad: boolean;
  requireExplicitSellability?: boolean;
  allowUnknownSellability?: boolean;
  promotionEvent?: boolean;
}, verifyExit:(request:ExitRequest)=>Promise<ExitVerification> = verifyCustomTokenExit): Promise<BoostSecurityGateDecision> {
  if (args.verifiedTrustedLaunchpad) return {
    allowed: true,
    route: 'TRUSTED_LAUNCHPAD',
    liquidity: null,
    reason: 'verified approved launchpad origin; separate security screening bypassed by policy, market risks remain',
    cached: false,
  };

  const key = normalize(args.tokenAddress) + ':' + (args.pairId?.toLowerCase() ?? '') + (args.requireExplicitSellability ? ':explicit-sellability' : '') + (args.allowUnknownSellability ? ':dex-warn-unknown' : '') + (args.promotionEvent ? ':promotion-policy-v1' : '');
  const now = Date.now();
  const prior = cache.get(key);
  if (prior && prior.expiresAt > now) return { ...prior.value, cached: true };

  evidenceCache.delete(normalize(args.tokenAddress));
  const liquidity = await fetchCustomLiquidityProtection(args.tokenAddress, false, true);
  if (args.promotionEvent && liquidity.allowed) {
    let pair: any;
    try {
      const response = await governedDexScreenerJson<any[]>({ url: `https://api.dexscreener.com/token-pairs/v1/robinhood/${args.tokenAddress}`,
        caller: 'promotion_sell_activity', endpoint: 'TOKEN_PAIRS', priority: 'HIGH', cacheKey: `promotion-sells:robinhood:${normalize(args.tokenAddress)}`,
        cacheTtlMs: 15000, queueWaitTimeoutMs: 1000, httpTimeoutMs: 2500 });
      pair = response.value.filter(p => p.chainId === 'robinhood' && String(p.baseToken?.address).toLowerCase() === normalize(args.tokenAddress)
        && (!args.pairId || String(p.pairAddress).toLowerCase() === args.pairId.toLowerCase()))
        .sort((a,b) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0))[0];
    } catch { /* Missing sell evidence remains watch-only. */ }
    const sells = reportedPromotionSells(pair);
    const decision = promotionAlertPolicy({ sells, exitVerified: true, lpStatus: liquidity.status });
    if (!decision.allowed) return { allowed: false, route: 'CUSTOM_SECURITY_REQUIRED', liquidity, reason: decision.reason, cached: false, exitUnverified: true };
    args = { ...args, pairId: pair.pairAddress };
  }
  const exit=liquidity.allowed?await verifyExit({chain:'robinhood',token:args.tokenAddress,pairId:args.pairId,security:evidenceCache.get(normalize(args.tokenAddress))}):null;
  if(exit){liquidity.allowed=exit.allowed;liquidity.status=exit.lpStatus ?? liquidity.status;liquidity.reason=exit.reason+' · '+(liquidity.status==='UNLOCKED'?'RISKY ALERT — LIQUIDITY NOT LOCKED. Liquidity can be withdrawn; you may lose your investment. Trade at your own risk.':liquidity.status==='UNKNOWN'?'RISKY ALERT — LP LOCK STATUS UNAVAILABLE. LP lock: Unable to verify. Liquidity protection is unverified; you may lose your investment. Trade at your own risk.':liquidity.reason);}
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
    sellabilityVerified: exit?.allowed===true,
    exitPairId:exit?.pairId,
    exitUnverified:exit!=null&&!exit.allowed,
  };
  if (cache.size >= 200 && !cache.has(key)) cache.delete(cache.keys().next().value!);
  cache.set(key, { expiresAt: now + (value.allowed ? SAFE_TTL_MS : BLOCKED_TTL_MS), value });
  return value;
}

export function clearBoostSecurityRouterCacheForTests(): void { cache.clear(); evidenceCache.clear(); }
