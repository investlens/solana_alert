import {
  collectPonsTokenOutcomes,
  createProductionPonsOutcomeSource,
  type PonsOutcomeCollection,
  type PonsOutcomeLaunch,
  type PonsOutcomeProgress,
} from './ponsTokenOutcomeCollector.js';
import {
  refreshPonsDeveloperRegistryForDeployers,
  type PonsDeveloperRegistryEntry,
} from './ponsDeveloperRegistry.js';
import type { PonsDeveloperTier } from './ponsDeveloperIntelligence.js';

const lower = (value: string) => value.trim().toLowerCase();
const identity = (factory: string, token: string) => `${lower(factory)}:${lower(token)}`;

export type PonsLearningState = {
  outcomeCheckedAt: Map<string, string>;
  registryRefreshedAt: Map<string, string>;
};

export type PonsLearningSummary = {
  selected: number;
  outcomesWritten: number;
  distinctDeployers: number;
  registryRefreshed: number;
  registryCreated: number;
  registryUpdated: number;
  tiers: Record<PonsDeveloperTier, number>;
  blocked: number;
};

export type PonsDeveloperLearningDependencies = {
  selectCandidates(limit: number, staleBefore: string): Promise<PonsOutcomeLaunch[]>;
  collectOutcomes(launches: PonsOutcomeLaunch[], onProgress?: (progress: PonsOutcomeProgress) => void): Promise<PonsOutcomeCollection>;
  loadExistingRegistry(deployers: string[]): Promise<Set<string>>;
  refreshDeployers(deployers: string[]): Promise<PonsDeveloperRegistryEntry[]>;
};

export function selectPonsLearningCandidates(
  launches: PonsOutcomeLaunch[], state: PonsLearningState, limit: number, staleBefore: string,
): PonsOutcomeLaunch[] {
  const selected: PonsOutcomeLaunch[] = [];
  const registryOnlyDeployers = new Set<string>();
  for (const launch of launches) {
    if (selected.length >= limit) break;
    const deployer = lower(launch.deployer_address);
    const outcomeCheckedAt = state.outcomeCheckedAt.get(identity(launch.factory_address, launch.token_address));
    const registryRefreshedAt = state.registryRefreshedAt.get(deployer);
    const outcomeNeedsLearning = !outcomeCheckedAt || outcomeCheckedAt < staleBefore;
    const registryNeedsLearning = !registryRefreshedAt || registryRefreshedAt < staleBefore;
    if (outcomeNeedsLearning) {
      selected.push(launch);
      if (registryNeedsLearning) registryOnlyDeployers.add(deployer);
    } else if (registryNeedsLearning && !registryOnlyDeployers.has(deployer)) {
      selected.push(launch);
      registryOnlyDeployers.add(deployer);
    }
  }
  return selected;
}

const tierNames: PonsDeveloperTier[] = [
  'GEM', 'KING', 'LEGEND', 'PROVEN', 'PROMISING', 'UNKNOWN', 'HIGH_RISK', 'SPAM_LAUNCHER', 'SCAMMER',
];

function tierCounts(entries: PonsDeveloperRegistryEntry[]): Record<PonsDeveloperTier, number> {
  return Object.fromEntries(tierNames.map(tier => [tier, entries.filter(entry => entry.tier === tier).length])) as
    Record<PonsDeveloperTier, number>;
}

export async function learnPonsDevelopers(options: {
  limit?: number;
  staleAfterMs?: number;
  now?: Date;
  onSelected?: (count: number) => void;
  onOutcomeProgress?: (progress: PonsOutcomeProgress) => void;
} = {}, deps?: PonsDeveloperLearningDependencies): Promise<PonsLearningSummary> {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error('limit must be an integer between 1 and 1000');
  const staleAfterMs = options.staleAfterMs ?? 24 * 60 * 60 * 1_000;
  if (!Number.isFinite(staleAfterMs) || staleAfterMs < 1) throw new Error('staleAfterMs must be positive');
  const dependencies = deps ?? await createProductionPonsLearningDependencies();
  const now = options.now ?? new Date();
  const staleBefore = new Date(now.getTime() - staleAfterMs).toISOString();
  const candidates = await dependencies.selectCandidates(limit, staleBefore);
  options.onSelected?.(candidates.length);
  const deployers = [...new Set(candidates.map(row => lower(row.deployer_address)))];
  const existing = await dependencies.loadExistingRegistry(deployers);
  const outcomes = await dependencies.collectOutcomes(candidates, options.onOutcomeProgress);
  const refreshed = await dependencies.refreshDeployers(deployers);
  return {
    selected: candidates.length,
    outcomesWritten: outcomes.writes,
    distinctDeployers: deployers.length,
    registryRefreshed: refreshed.length,
    registryCreated: refreshed.filter(entry => !existing.has(lower(entry.deployerAddress))).length,
    registryUpdated: refreshed.filter(entry => existing.has(lower(entry.deployerAddress))).length,
    tiers: tierCounts(refreshed),
    blocked: refreshed.filter(entry => entry.isBlocked).length,
  };
}

type OutcomeFreshnessRow = { factory_address: string; token_address: string; last_checked_at: string };
type RegistryFreshnessRow = { deployer_address: string; refreshed_at: string };

async function loadFreshness(launches: PonsOutcomeLaunch[]): Promise<PonsLearningState> {
  const { supabase } = await import('../../services/supabase.js');
  const tokens = [...new Set(launches.map(row => lower(row.token_address)))];
  const deployers = [...new Set(launches.map(row => lower(row.deployer_address)))];
  const [{ data: outcomeData, error: outcomeError }, { data: registryData, error: registryError }] = await Promise.all([
    supabase.from('pons_token_outcomes').select('factory_address,token_address,last_checked_at')
      .eq('chain', 'robinhood').in('token_address', tokens),
    supabase.from('pons_developer_registry').select('deployer_address,refreshed_at')
      .eq('chain', 'robinhood').in('deployer_address', deployers),
  ]);
  if (outcomeError) throw new Error(`Pons outcome freshness load failed: ${outcomeError.message}`);
  if (registryError) throw new Error(`Pons registry freshness load failed: ${registryError.message}`);
  return {
    outcomeCheckedAt: new Map(((outcomeData ?? []) as OutcomeFreshnessRow[])
      .map(row => [identity(row.factory_address, row.token_address), row.last_checked_at])),
    registryRefreshedAt: new Map(((registryData ?? []) as RegistryFreshnessRow[])
      .map(row => [lower(row.deployer_address), row.refreshed_at])),
  };
}

async function selectProductionCandidates(limit: number, staleBefore: string): Promise<PonsOutcomeLaunch[]> {
  const { supabase } = await import('../../services/supabase.js');
  const selected: PonsOutcomeLaunch[] = [];
  const pageSize = 250;
  const registryOnlyDeployers = new Set<string>();
  for (let from = 0; selected.length < limit; from += pageSize) {
    const { data, error } = await supabase.from('pons_launches')
      .select('factory_address,token_address,deployer_address,protocol_version,block_timestamp')
      .eq('chain', 'robinhood').order('block_timestamp', { ascending: false })
      .order('token_address', { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw new Error(`Pons learning candidate load failed: ${error.message}`);
    const page = (data ?? []) as PonsOutcomeLaunch[];
    if (!page.length) break;
    const state = await loadFreshness(page);
    for (const launch of page) {
      if (selected.length >= limit) break;
      const deployer = lower(launch.deployer_address);
      const outcomeCheckedAt = state.outcomeCheckedAt.get(identity(launch.factory_address, launch.token_address));
      const registryRefreshedAt = state.registryRefreshedAt.get(deployer);
      const outcomeNeedsLearning = !outcomeCheckedAt || outcomeCheckedAt < staleBefore;
      const registryNeedsLearning = !registryRefreshedAt || registryRefreshedAt < staleBefore;
      if (outcomeNeedsLearning) {
        selected.push(launch);
        if (registryNeedsLearning) registryOnlyDeployers.add(deployer);
      }
      else if (registryNeedsLearning && !registryOnlyDeployers.has(deployer)) {
        selected.push(launch);
        registryOnlyDeployers.add(deployer);
      }
    }
    if (page.length < pageSize) break;
  }
  return selected;
}

export async function createProductionPonsLearningDependencies(): Promise<PonsDeveloperLearningDependencies> {
  const outcomeSource = await createProductionPonsOutcomeSource();
  return {
    selectCandidates: selectProductionCandidates,
    collectOutcomes: (launches, onProgress) => collectPonsTokenOutcomes(outcomeSource, {
      launches, filters: { limit: Math.max(launches.length, 1) }, write: true, onProgress,
    }),
    async loadExistingRegistry(deployers) {
      if (!deployers.length) return new Set();
      const { supabase } = await import('../../services/supabase.js');
      const { data, error } = await supabase.from('pons_developer_registry').select('deployer_address')
        .eq('chain', 'robinhood').in('deployer_address', deployers);
      if (error) throw new Error(`Pons registry existence load failed: ${error.message}`);
      return new Set((data ?? []).map((row: { deployer_address: string }) => lower(row.deployer_address)));
    },
    refreshDeployers: deployers => refreshPonsDeveloperRegistryForDeployers(deployers),
  };
}
