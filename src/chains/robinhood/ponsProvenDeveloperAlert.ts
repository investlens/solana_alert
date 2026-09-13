import type { PonsDeveloperRegistryEntry } from './ponsDeveloperRegistry.js';
import type { PonsDeveloperTier } from './ponsDeveloperIntelligence.js';
import type { PonsLaunch } from './ponsHistoricalLaunchScanner.js';

const icon: Partial<Record<PonsDeveloperTier, string>> = { GEM: '💎', KING: '👑', LEGEND: '🏆' };
const money = (value: number | null) => value == null
  ? 'unknown'
  : `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const pct = (value: number | null | undefined) => value == null || !Number.isFinite(value)
  ? 'unknown'
  : `${Math.round((value <= 1 ? value * 100 : value) * 10) / 10}%`;
const short = (value: string) => value.length > 20 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;

export function hasRepeatablePonsDeveloperHistory(developer: PonsDeveloperRegistryEntry): boolean {
  return developer.usableOutcomes >= 5
    && developer.winners100k >= 2
    && (developer.confidence === 'MEDIUM' || developer.confidence === 'HIGH');
}

export type PonsProvenDeveloperAlert = {
  kind: 'PONS_PROVEN_DEV_LAUNCH';
  priority: 'HIGH';
  launchIdentity: string;
  tokenAddress: string;
  developerAddress: string;
  developerTier: PonsDeveloperTier;
  text: string;
};

export function createPonsProvenDeveloperAlert(
  launch: PonsLaunch,
  developer: PonsDeveloperRegistryEntry,
  identity: string,
): PonsProvenDeveloperAlert {
  const tier = developer.tier;
  const badge = icon[tier] ?? '✅';
  const launches = developer.totalLaunches ?? 0;
  const winners100k = developer.winners100k ?? 0;
  const winners1m = developer.winners1m ?? 0;
  const hitRate100k = pct(developer.hitRate100k);
  const hitRate1m = pct(developer.hitRate1m);
  const repeatable = hasRepeatablePonsDeveloperHistory(developer);
  const headline = repeatable ? '🏆 PROVEN DEV IS BACK' : '💎 HIGH-PERFORMING DEV LAUNCH';
  const repeatability = repeatable ? 'PROVEN' : 'UNPROVEN';
  const alphaRead = repeatable
    ? 'repeatable developer history detected'
    : 'strong historical peak detected; repeatability is not yet proven';

  return {
    kind: 'PONS_PROVEN_DEV_LAUNCH',
    priority: 'HIGH',
    launchIdentity: identity,
    tokenAddress: launch.token_address,
    developerAddress: launch.deployer_address,
    developerTier: tier,
    text: [
      '🔥 SUCCESSFUL DEV LAUNCH',
      headline,
      '━━━━━━━━━━━━━━━━━━',
      '🟢 PONS VERIFIED LAUNCH',
      `Tier: ${badge} ${tier}`,
      `Confidence: ${developer.confidence}`,
      `Repeatability: ${repeatability}`,
      '',
      `🧠 Dev: ${short(launch.deployer_address)}`,
      `🪙 New contract: ${launch.token_address}`,
      '',
      '📊 VERIFIED HISTORY',
      `• Verified outcomes: ${developer.usableOutcomes}`,
      `• Total launches: ${launches}`,
      `• $100K+ winners: ${winners100k} · hit rate ${hitRate100k}`,
      `• $1M+ winners: ${winners1m} · hit rate ${hitRate1m}`,
      `• $5M+ winners: ${developer.winners5m}`,
      `• $10M+ winners: ${developer.winners10m}`,
      `• Best verified peak: ${money(developer.bestVerifiedPeakMarketCap)}`,
      '',
      `⚡ AlphaOS read: ${alphaRead}`,
      '🛡️ Developer history adds context — token security still decides eligibility.',
      '🟢 MANUAL TRADE MODE · Auto-buy disabled',
    ].join('\n'),
  };
}