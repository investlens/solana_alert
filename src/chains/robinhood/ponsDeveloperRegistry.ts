import {
  getAllPonsDeveloperIntelligence,
  getPonsDeveloperIntelligence,
  type PonsDeveloperIntelligence,
  type PonsDeveloperTier,
  type PonsSampleConfidence,
} from './ponsDeveloperIntelligence.js';

export type PonsDeveloperRegistryEntry = {
  deployerAddress: string;
  tier: PonsDeveloperTier;
  riskTier: string | null;
  confidence: PonsSampleConfidence;
  isBlocked: boolean;
  blockReason: string | null;
  blockedAt: string | null;
  totalLaunches: number;
  usableOutcomes: number;
  winners100k: number;
  winners500k: number;
  winners1m: number;
  winners5m: number;
  winners10m: number;
  bestVerifiedPeakMarketCap: number | null;
  bestTokenAddress: string | null;
  hitRate100k: number | null;
  hitRate1m: number | null;
  recent5Hits100k: number;
  recent5Hits1m: number;
  severeCrashCount: number;
  severeCrashRate: number | null;
  catastrophicCrashCount: number;
  catastrophicCrashRate: number | null;
  firstLaunchAt: string | null;
  latestLaunchAt: string | null;
  lastSuccessfulTokenAddress: string | null;
  lastSuccessfulPeakMarketCap: number | null;
};

export type PonsIgnoreDecision = {
  ignore: boolean;
  reason: string | null;
  tier: PonsDeveloperTier | 'UNKNOWN';
  evidence: {
    totalLaunches: number;
    usableOutcomes: number;
    winners100k: number;
    winners1m: number;
    severeCrashRate: number | null;
    catastrophicCrashRate: number | null;
  } | null;
};

const lower = (value: string) => value.trim().toLowerCase();

export function registryEntryFromIntelligence(
  intelligence: PonsDeveloperIntelligence,
  now = new Date().toISOString(),
): PonsDeveloperRegistryEntry {
  return {
    deployerAddress: lower(intelligence.developerAddress),
    tier: intelligence.tier,
    riskTier: intelligence.riskTier,
    confidence: intelligence.sampleConfidence,
    isBlocked: intelligence.isBlocked,
    blockReason: intelligence.blockReason,
    blockedAt: intelligence.isBlocked ? now : null,
    totalLaunches: intelligence.totalPonsLaunches,
    usableOutcomes: intelligence.launchesWithUsableOutcomes,
    winners100k: intelligence.winners100k,
    winners500k: intelligence.winners500k,
    winners1m: intelligence.winners1m,
    winners5m: intelligence.winners5m,
    winners10m: intelligence.winners10m,
    bestVerifiedPeakMarketCap: intelligence.bestKnownPeakMarketCap,
    bestTokenAddress: intelligence.bestTokenAddress,
    hitRate100k: intelligence.hitRate100k,
    hitRate1m: intelligence.hitRate1m,
    recent5Hits100k: intelligence.recent5Hits100k,
    recent5Hits1m: intelligence.recent5Hits1m,
    severeCrashCount: intelligence.severeCrashCount,
    severeCrashRate: intelligence.severeCrashRate,
    catastrophicCrashCount: intelligence.catastrophicCrashCount,
    catastrophicCrashRate: intelligence.catastrophicCrashRate,
    firstLaunchAt: intelligence.firstLaunch,
    latestLaunchAt: intelligence.latestLaunch,
    lastSuccessfulTokenAddress: intelligence.lastSuccessfulTokenAddress,
    lastSuccessfulPeakMarketCap: intelligence.lastSuccessfulPeakMarketCap,
  };
}

function dbRow(entry: PonsDeveloperRegistryEntry, refreshedAt = new Date().toISOString()) {
  return {
    chain: 'robinhood', deployer_address: entry.deployerAddress, tier: entry.tier, risk_tier: entry.riskTier,
    confidence: entry.confidence, is_blocked: entry.isBlocked, block_reason: entry.blockReason,
    blocked_at: entry.blockedAt, total_launches: entry.totalLaunches, usable_outcomes: entry.usableOutcomes,
    winners_100k: entry.winners100k, winners_500k: entry.winners500k, winners_1m: entry.winners1m,
    winners_5m: entry.winners5m, winners_10m: entry.winners10m,
    best_verified_peak_market_cap: entry.bestVerifiedPeakMarketCap, best_token_address: entry.bestTokenAddress,
    hit_rate_100k: entry.hitRate100k, hit_rate_1m: entry.hitRate1m,
    recent_5_hits_100k: entry.recent5Hits100k, recent_5_hits_1m: entry.recent5Hits1m,
    severe_crash_count: entry.severeCrashCount, severe_crash_rate: entry.severeCrashRate,
    catastrophic_crash_count: entry.catastrophicCrashCount, catastrophic_crash_rate: entry.catastrophicCrashRate,
    first_launch_at: entry.firstLaunchAt, latest_launch_at: entry.latestLaunchAt,
    last_successful_token_address: entry.lastSuccessfulTokenAddress,
    last_successful_peak_market_cap: entry.lastSuccessfulPeakMarketCap, refreshed_at: refreshedAt,
    updated_at: refreshedAt,
  };
}

export type PonsRegistryRefreshDependencies = {
  load?: (deployer?: string) => Promise<PonsDeveloperIntelligence[]>;
  upsert?: (rows: ReturnType<typeof dbRow>[]) => Promise<void>;
};

async function persistEntries(entries: PonsDeveloperRegistryEntry[], deps: PonsRegistryRefreshDependencies): Promise<void> {
  if (!entries.length) return;
  const rows = entries.map(entry => dbRow(entry));
  if (deps.upsert) return deps.upsert(rows);
  const { supabase } = await import('../../services/supabase.js');
  const { error } = await supabase.from('pons_developer_registry').upsert(rows, { onConflict: 'chain,deployer_address' });
  if (error) throw new Error(`Pons registry upsert failed: ${error.message}`);
}

export async function refreshPonsDeveloperRegistry(
  options: { deployer?: string; limit?: number } = {},
  deps: PonsRegistryRefreshDependencies = {},
): Promise<PonsDeveloperRegistryEntry[]> {
  const load = deps.load ?? (async (deployer?: string) => {
    if (!deployer) return getAllPonsDeveloperIntelligence();
    const intelligence = await getPonsDeveloperIntelligence(deployer);
    return intelligence ? [intelligence] : [];
  });
  let intelligence = await load(options.deployer ? lower(options.deployer) : undefined);
  if (options.limit != null) intelligence = intelligence.slice(0, options.limit);
  const entries = intelligence.map(item => registryEntryFromIntelligence(item));
  await persistEntries(entries, deps);
  return entries;
}

export async function refreshPonsDeveloperRegistryForDeployers(
  deployerAddresses: string[],
  deps: PonsRegistryRefreshDependencies = {},
): Promise<PonsDeveloperRegistryEntry[]> {
  const unique = [...new Set(deployerAddresses.map(lower))];
  const entries: PonsDeveloperRegistryEntry[] = [];
  for (const deployer of unique) {
    const intelligence = deps.load
      ? (await deps.load(deployer))[0] ?? null
      : await getPonsDeveloperIntelligence(deployer);
    if (intelligence) entries.push(registryEntryFromIntelligence(intelligence));
  }
  await persistEntries(entries, deps);
  return entries;
}

function fromDb(row: any): PonsDeveloperRegistryEntry {
  return {
    deployerAddress: row.deployer_address, tier: row.tier, riskTier: row.risk_tier, confidence: row.confidence,
    isBlocked: row.is_blocked, blockReason: row.block_reason, blockedAt: row.blocked_at,
    totalLaunches: row.total_launches, usableOutcomes: row.usable_outcomes, winners100k: row.winners_100k,
    winners500k: row.winners_500k, winners1m: row.winners_1m, winners5m: row.winners_5m,
    winners10m: row.winners_10m, bestVerifiedPeakMarketCap: row.best_verified_peak_market_cap,
    bestTokenAddress: row.best_token_address, hitRate100k: row.hit_rate_100k, hitRate1m: row.hit_rate_1m,
    recent5Hits100k: row.recent_5_hits_100k, recent5Hits1m: row.recent_5_hits_1m,
    severeCrashCount: row.severe_crash_count, severeCrashRate: row.severe_crash_rate,
    catastrophicCrashCount: row.catastrophic_crash_count, catastrophicCrashRate: row.catastrophic_crash_rate,
    firstLaunchAt: row.first_launch_at, latestLaunchAt: row.latest_launch_at,
    lastSuccessfulTokenAddress: row.last_successful_token_address,
    lastSuccessfulPeakMarketCap: row.last_successful_peak_market_cap,
  };
}

export async function getPonsDeveloperRegistryEntry(address: string): Promise<PonsDeveloperRegistryEntry | null> {
  const { supabase } = await import('../../services/supabase.js');
  const { data, error } = await supabase.from('pons_developer_registry').select('*').eq('chain', 'robinhood')
    .eq('deployer_address', lower(address)).maybeSingle();
  if (error) throw new Error(`Pons registry lookup failed: ${error.message}`);
  return data ? fromDb(data) : null;
}

export function shouldIgnorePonsDeveloperEntry(entry: PonsDeveloperRegistryEntry | null): PonsIgnoreDecision {
  return {
    ignore: entry?.isBlocked === true, reason: entry?.blockReason ?? null, tier: entry?.tier ?? 'UNKNOWN',
    evidence: entry ? { totalLaunches: entry.totalLaunches, usableOutcomes: entry.usableOutcomes,
      winners100k: entry.winners100k, winners1m: entry.winners1m, severeCrashRate: entry.severeCrashRate,
      catastrophicCrashRate: entry.catastrophicCrashRate } : null,
  };
}

export async function shouldIgnorePonsDeveloper(address: string) {
  return shouldIgnorePonsDeveloperEntry(await getPonsDeveloperRegistryEntry(address));
}
