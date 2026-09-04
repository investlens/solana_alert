import type { PonsDeveloperRegistryEntry } from './ponsDeveloperRegistry.js';
import type { PonsLaunch } from './ponsHistoricalLaunchScanner.js';

const icon = { GEM: '💎', KING: '👑', LEGEND: '🏆' } as const;
const money = (value: number | null) => value == null
  ? 'unknown'
  : `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export type PonsProvenDeveloperAlert = {
  kind: 'PONS_PROVEN_DEV_LAUNCH';
  priority: 'HIGH';
  launchIdentity: string;
  tokenAddress: string;
  developerAddress: string;
  developerTier: 'GEM' | 'KING' | 'LEGEND';
  text: string;
};

export function createPonsProvenDeveloperAlert(
  launch: PonsLaunch,
  developer: PonsDeveloperRegistryEntry,
  identity: string,
): PonsProvenDeveloperAlert {
  const tier = developer.tier as keyof typeof icon;
  return {
    kind: 'PONS_PROVEN_DEV_LAUNCH',
    priority: 'HIGH',
    launchIdentity: identity,
    tokenAddress: launch.token_address,
    developerAddress: launch.deployer_address,
    developerTier: tier,
    text: [
      '🚨 PONS PROVEN DEV LAUNCH', '',
      `Tier: ${icon[tier]} ${tier}`,
      `Developer: ${launch.deployer_address}`,
      `Token: ${launch.token_address}`, '',
      'History:',
      `Total launches: ${developer.totalLaunches}`,
      `$100K+ winners: ${developer.winners100k}`,
      `$1M+ winners: ${developer.winners1m}`,
      `$5M+ winners: ${developer.winners5m}`,
      `$10M+ winners: ${developer.winners10m}`,
      `Best verified launch: ${money(developer.bestVerifiedPeakMarketCap)}`,
      `Confidence: ${developer.confidence}`, '',
      '⚡ New Pons launch detected',
      '🟢 MANUAL TRADE MODE',
      '🚫 Auto-buy disabled',
    ].join('\n'),
  };
}
