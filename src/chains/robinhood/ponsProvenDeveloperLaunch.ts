import { confirmMomentum, type MomentumDecision } from '../../services/momentumConfirmation.js';
import type { RiskResult } from '../../types.js';
import type { ChainMarketSnapshot } from '../shared/types.js';
import type { PonsDeveloperRegistryEntry } from './ponsDeveloperRegistry.js';
import type { PonsLaunch } from './ponsHistoricalLaunchScanner.js';

export type PonsLiveMarketEvidence = {
  tokenAddress: string; price: number | null; marketCap: number | null;
  liquidity: number | null; volume5m: number | null; buys5m: number | null;
  sells5m: number | null; buyRatio: number | null; pairAddress: string | null;
  tokenAgeSeconds: number | null; pairValid: boolean; observedAt: string;
};
export type PonsShadowDecision = {
  mode: 'SHADOW'; action: 'BUY' | 'IGNORE'; reason: string;
  tokenAddress: string; deployerAddress: string; developerTier: string;
  developerConfidence: string; momentum: MomentumDecision | 'NOT_RUN';
  initialSnapshot: PonsLiveMarketEvidence | null;
  confirmationSnapshot: PonsLiveMarketEvidence | null; decidedAt: string;
};

const positive = (value: number | undefined) => Number.isFinite(value) && value! > 0 ? value! : null;
export function toPonsLiveMarketEvidence(snapshot: ChainMarketSnapshot | null, expectedToken: string, now = Date.now()): PonsLiveMarketEvidence | null {
  if (!snapshot || !snapshot.tokenAddress) return null;
  const buys = positive(snapshot.buys5m); const sells = positive(snapshot.sells5m);
  return {
    tokenAddress: snapshot.tokenAddress.toLowerCase(), price: positive(snapshot.priceUsd),
    marketCap: positive(snapshot.marketCapUsd), liquidity: positive(snapshot.liquidityUsd),
    volume5m: positive(snapshot.volume5mUsd), buys5m: buys, sells5m: sells,
    buyRatio: buys == null ? null : buys / (sells ?? 1), pairAddress: snapshot.pairAddress?.toLowerCase() ?? null,
    tokenAgeSeconds: snapshot.pairCreatedAt ? Math.max(0, (now - snapshot.pairCreatedAt) / 1000) : null,
    pairValid: snapshot.chain === 'robinhood' && snapshot.tokenAddress.toLowerCase() === expectedToken.toLowerCase()
      && Boolean(snapshot.pairAddress), observedAt: new Date(snapshot.timestamp).toISOString(),
  };
}

export function evaluatePonsProvenDeveloperLaunch(developer: PonsDeveloperRegistryEntry, market: PonsLiveMarketEvidence | null) {
  const reasons: string[] = [];
  if (!['GEM', 'KING', 'LEGEND'].includes(developer.tier)) reasons.push('developer tier is not eligible');
  if (developer.isBlocked || developer.riskTier) reasons.push('developer is blocked or risky');
  if (!market?.pairValid || market.price == null || market.marketCap == null || market.liquidity == null) {
    reasons.push('insufficient live market evidence');
  }
  return { eligibleForConfirmation: reasons.length === 0, reasons, developer, token: market?.tokenAddress ?? null, initialMarket: market };
}

function risk(snapshot: PonsLiveMarketEvidence): RiskResult {
  return { score: 0, risk: 'LOW', action: 'WATCH', checksGood: [], checksWarn: [], checksBad: [],
    liquidityUsd: snapshot.liquidity ?? 0, ageMin: (snapshot.tokenAgeSeconds ?? 0) / 60,
    buys5m: snapshot.buys5m ?? 0, sells5m: snapshot.sells5m ?? 0, volume5m: snapshot.volume5m ?? 0,
    boosts: 0, paidApproved: false, hasProfileLinks: false, fdv: 0, marketCap: snapshot.marketCap ?? 0,
    currentPrice: snapshot.price, marketSafetyScore: 0, marketSafetyLabel: 'WATCH', authoritySafetyScore: 0,
    authoritySafetyLabel: 'GOOD', mintAuthority: null, freezeAuthority: null, updateAuthority: null, isMutable: null };
}

export function decidePonsShadowLaunch(args: { launch: PonsLaunch; developer: PonsDeveloperRegistryEntry;
  initial: PonsLiveMarketEvidence | null; confirmation: PonsLiveMarketEvidence | null; shadowEnabled: boolean }): PonsShadowDecision {
  const validation = evaluatePonsProvenDeveloperLaunch(args.developer, args.initial);
  let momentum: MomentumDecision | 'NOT_RUN' = 'NOT_RUN'; let reason = validation.reasons[0] ?? 'confirmation unavailable';
  if (validation.eligibleForConfirmation && args.initial && args.confirmation) {
    const result = confirmMomentum(risk(args.initial), risk(args.confirmation)); momentum = result.decision; reason = result.reason;
  }
  const buy = args.shadowEnabled && validation.eligibleForConfirmation && momentum === 'UPTREND';
  if (!args.shadowEnabled && validation.eligibleForConfirmation && momentum === 'UPTREND') reason = 'shadow buy feature is disabled';
  return { mode: 'SHADOW', action: buy ? 'BUY' : 'IGNORE', reason,
    tokenAddress: args.launch.token_address, deployerAddress: args.launch.deployer_address,
    developerTier: args.developer.tier, developerConfidence: args.developer.confidence,
    momentum, initialSnapshot: args.initial, confirmationSnapshot: args.confirmation, decidedAt: new Date().toISOString() };
}
