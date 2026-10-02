import type { PonsLaunchCensusRow } from './ponsDeveloperIntelligence.js';

export type PonsOutcomeLaunch = PonsLaunchCensusRow & { factory_address: string };
export type PonsMarketObservation = {
  tokenAddress: string; marketCap: number; observedAt: string;
  kind: 'HISTORICAL' | 'CURRENT'; source: string;
};
export type PonsCollectedTokenOutcome = {
  chain: 'robinhood'; factoryAddress: string; tokenAddress: string; deployerAddress: string;
  protocolVersion: string; launchedAt: string; currentMarketCap: number | null;
  peakMarketCap: number | null; firstMarketCap: number | null;
  crossed100k: boolean | null; crossed500k: boolean | null; crossed1m: boolean | null;
  crossed5m: boolean | null; crossed10m: boolean | null;
  severeCrash: boolean | null; catastrophicCrash: boolean | null; observationCount: number;
  peakSource: string | null; currentSource: string | null;
  dataConfidence: 'VERIFIED_HISTORY' | 'OBSERVED_HISTORY' | 'CURRENT_ONLY' | 'UNKNOWN';
  outcomeSource: string[]; firstObservedAt: string | null; lastObservedAt: string | null; lastCheckedAt: string;
};
export type PonsOutcomeCollectorFilters = { factory?: string; deployer?: string; token?: string; limit?: number; newestFirst?: boolean; launchedSince?: string; rotate?: boolean };
export type PonsStoredOutcome = Pick<PonsCollectedTokenOutcome, 'chain' | 'factoryAddress' | 'tokenAddress' | 'firstMarketCap' | 'currentMarketCap' | 'peakMarketCap' | 'peakSource' | 'currentSource' | 'dataConfidence' | 'observationCount' | 'firstObservedAt' | 'lastObservedAt'>;
export type PonsOutcomeCollectorSource = {
  loadLaunches(filters: PonsOutcomeCollectorFilters): Promise<PonsOutcomeLaunch[]>;
  loadHistoricalObservations(tokenAddresses: string[]): Promise<PonsMarketObservation[]>;
  loadCurrentObservation(launch: PonsOutcomeLaunch, signal?: AbortSignal): Promise<PonsMarketObservation | null>;
  loadPreviousOutcomes?(tokenAddresses: string[]): Promise<PonsStoredOutcome[]>;
  writeOutcomes?(outcomes: PonsCollectedTokenOutcome[]): Promise<void>;
};

// An observed peak is a sampled high, never an all-time high. Keep one compact
// summary per exact chain/factory/token; a missing provider response cannot erase it.
export function mergePonsOutcome(previous: PonsStoredOutcome | undefined, fresh: PonsCollectedTokenOutcome): PonsCollectedTokenOutcome {
  if (previous && (previous.chain !== fresh.chain || lower(previous.factoryAddress) !== fresh.factoryAddress
    || lower(previous.tokenAddress) !== fresh.tokenAddress)) throw new Error('outcome identity mismatch');
  const valid = (value: number | null | undefined): value is number => value != null && Number.isFinite(value) && value > 0;
  const newCurrent = valid(fresh.currentMarketCap) && fresh.lastObservedAt != null
    && (!previous?.lastObservedAt || Date.parse(fresh.lastObservedAt) > Date.parse(previous.lastObservedAt));
  const current = newCurrent || !previous ? fresh.currentMarketCap : previous.currentMarketCap;
  const sampledHistory = valid(fresh.peakMarketCap) || valid(previous?.peakMarketCap) || (valid(previous?.currentMarketCap) && newCurrent);
  const peaks = [
    { value: fresh.peakMarketCap, source: fresh.peakSource },
    { value: previous?.peakMarketCap, source: previous?.peakSource },
    ...(sampledHistory ? [{ value: fresh.currentMarketCap, source: fresh.currentSource },
      { value: previous?.currentMarketCap, source: previous?.currentSource }] : []),
  ].filter((row): row is { value: number; source: string | null | undefined } => valid(row.value));
  const peak = peaks.sort((a, b) => b.value - a.value)[0];
  const firstTimes = [previous?.firstObservedAt, fresh.firstObservedAt].filter((v): v is string => !!v).sort();
  const previousFirst = previous != null && previous.firstObservedAt === firstTimes[0] && valid(previous.firstMarketCap);
  const count = previous ? Math.max(previous.observationCount, fresh.observationCount - (fresh.currentMarketCap != null ? 1 : 0)) + (newCurrent ? 1 : 0) : fresh.observationCount;
  const confidence = fresh.dataConfidence === 'VERIFIED_HISTORY' || previous?.dataConfidence === 'VERIFIED_HISTORY'
    ? 'VERIFIED_HISTORY' : sampledHistory ? 'OBSERVED_HISTORY' : valid(current) ? 'CURRENT_ONLY' : 'UNKNOWN';
  const drawdown = peak && valid(current) ? current / peak.value - 1 : null;
  return { ...fresh, currentMarketCap: current, peakMarketCap: peak?.value ?? null, peakSource: peak?.source ?? null,
    firstMarketCap: previousFirst ? previous!.firstMarketCap : fresh.firstMarketCap,
    firstObservedAt: firstTimes[0] ?? null, lastObservedAt: newCurrent || !previous ? fresh.lastObservedAt : previous.lastObservedAt,
    currentSource: newCurrent || !previous ? fresh.currentSource : previous.currentSource,
    observationCount: count, dataConfidence: confidence,
    crossed100k: peak ? peak.value >= 100_000 : null, crossed500k: peak ? peak.value >= 500_000 : null,
    crossed1m: peak ? peak.value >= 1_000_000 : null, crossed5m: peak ? peak.value >= 5_000_000 : null,
    crossed10m: peak ? peak.value >= 10_000_000 : null,
    severeCrash: drawdown == null ? null : drawdown <= -0.8, catastrophicCrash: drawdown == null ? null : drawdown <= -0.9 };
}
export type PonsOutcomeCollection = {
  outcomes: PonsCollectedTokenOutcome[]; scanned: number; currentMcFound: number;
  historicalObservationsFound: number; verifiedPeakFound: number; crossed100k: number; crossed500k: number;
  crossed1m: number; crossed5m: number; crossed10m: number; unknown: number; currentLookupFailures: number; wrote: boolean; writes: number;
};
export type PonsOutcomeProgress = { processed: number; total: number; currentMcFound: number; historicalFound: number; currentLookupFailures: number };

export function formatPonsOutcomeSummary(result: PonsOutcomeCollection, dryRun: boolean): string[] {
  return [
    `[PonsOutcomes] scanned=${result.scanned}`,
    `[PonsOutcomes] currentMcFound=${result.currentMcFound}`,
    `[PonsOutcomes] historicalObservationsFound=${result.historicalObservationsFound}`,
    `[PonsOutcomes] verifiedPeakFound=${result.verifiedPeakFound}`,
    `[PonsOutcomes] crossed100k=${result.crossed100k}`,
    `[PonsOutcomes] crossed500k=${result.crossed500k}`,
    `[PonsOutcomes] crossed1m=${result.crossed1m}`,
    `[PonsOutcomes] crossed5m=${result.crossed5m}`,
    `[PonsOutcomes] crossed10m=${result.crossed10m}`,
    `[PonsOutcomes] unknown=${result.unknown}`,
    `[PonsOutcomes] currentLookupFailures=${result.currentLookupFailures}`,
    `[PonsOutcomes] dryRun=${dryRun} writes=${result.writes}`,
  ];
}

const lower = (value: string) => value.trim().toLowerCase();
const validObservation = (row: PonsMarketObservation) => Number.isFinite(row.marketCap) && row.marketCap > 0
  && Number.isFinite(Date.parse(row.observedAt));

export function derivePonsCollectedOutcome(launch: PonsOutcomeLaunch, observations: PonsMarketObservation[], now = new Date()): PonsCollectedTokenOutcome {
  const tokenAddress = lower(launch.token_address);
  const exact = observations.filter(row => lower(row.tokenAddress) === tokenAddress && validObservation(row));
  const historical = exact.filter(row => row.kind === 'HISTORICAL')
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.source.localeCompare(b.source));
  const currents = exact.filter(row => row.kind === 'CURRENT')
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.source.localeCompare(b.source));
  const current = currents[currents.length - 1] ?? null;
  const peak = historical.reduce<PonsMarketObservation | null>((best, row) => !best || row.marketCap > best.marketCap ? row : best, null);
  const first = [...historical, ...currents].sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.source.localeCompare(b.source))[0] ?? null;
  const latestEvidence = current ?? historical[historical.length - 1] ?? null;
  const drawdown = peak && latestEvidence && latestEvidence.observedAt >= peak.observedAt
    ? (latestEvidence.marketCap - peak.marketCap) / peak.marketCap : null;
  return {
    chain: 'robinhood', factoryAddress: lower(launch.factory_address), tokenAddress,
    deployerAddress: lower(launch.deployer_address), protocolVersion: launch.protocol_version, launchedAt: launch.block_timestamp,
    currentMarketCap: current?.marketCap ?? null, peakMarketCap: peak?.marketCap ?? null, firstMarketCap: first?.marketCap ?? null,
    crossed100k: peak ? peak.marketCap >= 100_000 : null, crossed500k: peak ? peak.marketCap >= 500_000 : null,
    crossed1m: peak ? peak.marketCap >= 1_000_000 : null,
    crossed5m: peak ? peak.marketCap >= 5_000_000 : null, crossed10m: peak ? peak.marketCap >= 10_000_000 : null,
    severeCrash: drawdown == null ? null : drawdown <= -0.8, catastrophicCrash: drawdown == null ? null : drawdown <= -0.9,
    observationCount: exact.length, peakSource: peak?.source ?? null, currentSource: current?.source ?? null,
    dataConfidence: historical.length ? 'VERIFIED_HISTORY' : current ? 'CURRENT_ONLY' : 'UNKNOWN',
    outcomeSource: [...new Set(exact.map(row => row.source))].sort(), firstObservedAt: first?.observedAt ?? null,
    lastObservedAt: latestEvidence?.observedAt ?? null, lastCheckedAt: now.toISOString(),
  };
}

async function mapConcurrent<T, R>(rows: T[], concurrency: number, work: (row: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(rows.length); let next = 0;
  async function worker() { for (;;) { const index = next++; if (index >= rows.length) return; results[index] = await work(rows[index]); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()));
  return results;
}

export async function collectPonsTokenOutcomes(source: PonsOutcomeCollectorSource, options: {
  filters?: PonsOutcomeCollectorFilters; concurrency?: number; write?: boolean; now?: Date;
  launches?: PonsOutcomeLaunch[]; currentRequestTimeoutMs?: number; progressInterval?: number;
  onProgress?: (progress: PonsOutcomeProgress) => void;
} = {}): Promise<PonsOutcomeCollection> {
  const filters = options.filters ?? {};
  const limit = filters.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error('limit must be an integer between 1 and 1000');
  const concurrency = options.concurrency ?? 5;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) throw new Error('concurrency must be an integer between 1 and 20');
  const timeoutMs = options.currentRequestTimeoutMs ?? 15_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error('current request timeout must be positive');
  const progressInterval = options.progressInterval ?? 25;
  if (!Number.isInteger(progressInterval) || progressInterval < 1) throw new Error('progress interval must be a positive integer');
  const launches = options.launches ?? await source.loadLaunches({ ...filters, limit });
  if (launches.length > 1_000) throw new Error('launch batch cannot exceed 1000');
  if (!launches.length) return { outcomes: [], scanned: 0, currentMcFound: 0, historicalObservationsFound: 0,
    verifiedPeakFound: 0, crossed100k: 0, crossed500k: 0, crossed1m: 0, crossed5m: 0, crossed10m: 0, unknown: 0,
    currentLookupFailures: 0, wrote: false, writes: 0 };
  const tokens = [...new Set(launches.map(row => lower(row.token_address)))];
  const historical = await source.loadHistoricalObservations(tokens);
  const previous = await source.loadPreviousOutcomes?.(tokens) ?? [];
  const previousByIdentity = new Map(previous.map(row => [`${row.factoryAddress.toLowerCase()}:${row.tokenAddress.toLowerCase()}`, row]));
  const historicalTokens = new Set(historical.filter(row => row.kind === 'HISTORICAL' && validObservation(row)).map(row => lower(row.tokenAddress)));
  let processed = 0; let progressCurrentFound = 0; let progressHistoricalFound = 0; let currentLookupFailures = 0;
  const current = await mapConcurrent(launches, concurrency, async launch => {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        source.loadCurrentObservation(launch, controller.signal),
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => {
          controller.abort(); reject(new Error(`current market lookup timed out after ${timeoutMs}ms`));
        }, timeoutMs); }),
      ]);
      const accepted = result && result.kind === 'CURRENT' && lower(result.tokenAddress) === lower(launch.token_address)
        && validObservation(result) ? result : null;
      if (accepted) progressCurrentFound += 1;
      return accepted;
    } catch {
      currentLookupFailures += 1; return null;
    } finally {
      if (timeout) clearTimeout(timeout);
      processed += 1;
      if (historicalTokens.has(lower(launch.token_address))) progressHistoricalFound += 1;
      if (processed % progressInterval === 0 || processed === launches.length) options.onProgress?.({ processed,
        total: launches.length, currentMcFound: progressCurrentFound, historicalFound: progressHistoricalFound, currentLookupFailures });
    }
  });
  const byToken = new Map<string, PonsMarketObservation[]>();
  for (const observation of historical) {
    const key = lower(observation.tokenAddress); byToken.set(key, [...(byToken.get(key) ?? []), observation]);
  }
  current.forEach((observation, index) => {
    if (!observation) return;
    const expected = lower(launches[index].token_address);
    if (lower(observation.tokenAddress) !== expected) return;
    byToken.set(expected, [...(byToken.get(expected) ?? []), observation]);
  });
  const outcomes = launches.map(launch => mergePonsOutcome(previousByIdentity.get(`${lower(launch.factory_address)}:${lower(launch.token_address)}`),
    derivePonsCollectedOutcome(launch, byToken.get(lower(launch.token_address)) ?? [], options.now)));
  if (options.write) {
    if (!source.writeOutcomes) throw new Error('Pons outcome persistence is unavailable until a dedicated provenance table exists');
    await source.writeOutcomes(outcomes);
  }
  return { outcomes, scanned: outcomes.length, currentMcFound: outcomes.filter(row => row.currentMarketCap != null).length,
    historicalObservationsFound: outcomes.filter(row => row.dataConfidence === 'VERIFIED_HISTORY').length,
    verifiedPeakFound: outcomes.filter(row => row.peakMarketCap != null).length,
    crossed100k: outcomes.filter(row => row.crossed100k === true).length,
    crossed500k: outcomes.filter(row => row.crossed500k === true).length,
    crossed1m: outcomes.filter(row => row.crossed1m === true).length,
    crossed5m: outcomes.filter(row => row.crossed5m === true).length,
    crossed10m: outcomes.filter(row => row.crossed10m === true).length,
    unknown: outcomes.filter(row => row.dataConfidence === 'UNKNOWN').length, currentLookupFailures,
    wrote: Boolean(options.write), writes: options.write ? outcomes.length : 0 };
}

type ObservationRow = Record<string, unknown> & { token_address: string; decision_at?: string | null; first_seen_at?: string | null };
const checkpoints = [
  ['market_cap_at_decision', 0, 'ROBINHOOD_OBSERVATION_DECISION'], ['market_cap_1m', 60, 'ROBINHOOD_OBSERVATION_1M'],
  ['market_cap_2m', 120, 'ROBINHOOD_OBSERVATION_2M'], ['market_cap_3m', 180, 'ROBINHOOD_OBSERVATION_3M'],
  ['market_cap_5m', 300, 'ROBINHOOD_OBSERVATION_5M'], ['market_cap_15m', 900, 'ROBINHOOD_OBSERVATION_15M'],
  ['market_cap_30m', 1_800, 'ROBINHOOD_OBSERVATION_30M'], ['market_cap_1h', 3_600, 'ROBINHOOD_OBSERVATION_1H'],
] as const;

export function historicalObservationsFromRobinhoodRows(rows: ObservationRow[]): PonsMarketObservation[] {
  return rows.flatMap(row => {
    const base = Date.parse(String(row.decision_at ?? row.first_seen_at ?? ''));
    if (!Number.isFinite(base)) return [];
    return checkpoints.flatMap(([column, seconds, source]) => {
      const marketCap = Number(row[column]);
      return Number.isFinite(marketCap) && marketCap > 0 ? [{ tokenAddress: lower(row.token_address), marketCap,
        observedAt: new Date(base + seconds * 1_000).toISOString(), kind: 'HISTORICAL' as const, source }] : [];
    });
  });
}

export async function createProductionPonsOutcomeSource(): Promise<PonsOutcomeCollectorSource> {
  const [{ supabase }, { getRobinhoodMarketSnapshot }] = await Promise.all([
    import('../../services/supabase.js'), import('./market.js'),
  ]);
  return {
    async loadLaunches(filters) {
      let query = supabase.from('pons_launches').select('factory_address,token_address,deployer_address,protocol_version,block_timestamp')
        .eq('chain', 'robinhood').order('block_timestamp', { ascending: !filters.newestFirst }).limit(filters.rotate ? 500 : filters.limit ?? 100);
      if (filters.factory) query = query.eq('protocol_version', filters.factory);
      if (filters.deployer) query = query.eq('deployer_address', lower(filters.deployer));
      if (filters.token) query = query.eq('token_address', lower(filters.token));
      if (filters.launchedSince) query = query.gte('block_timestamp', filters.launchedSince);
      const { data, error } = await query;
      if (error) throw new Error(`Pons launch load failed: ${error.message}`);
      const launches = (data ?? []) as PonsOutcomeLaunch[];
      if (!filters.rotate || !launches.length) return launches;
      if (launches.length === 500) console.warn('[PonsOutcomes] recent census capacity reached; coverage incomplete');
      const times = new Map<string, number>();
      for (let index = 0; index < launches.length; index += 100) {
        const { data: checked, error: checkedError } = await supabase.from('pons_token_outcomes')
          .select('factory_address,token_address,last_checked_at').eq('chain', 'robinhood')
          .in('token_address', launches.slice(index, index + 100).map(row => row.token_address));
        if (checkedError) throw new Error(`Pons collection rotation failed: ${checkedError.message}`);
        for (const row of checked ?? []) times.set(`${row.factory_address}:${row.token_address}`, Date.parse(row.last_checked_at ?? '') || 0);
      }
      return launches.sort((a, b) => (times.get(`${a.factory_address}:${a.token_address}`) ?? 0)
        - (times.get(`${b.factory_address}:${b.token_address}`) ?? 0)).slice(0, filters.limit ?? 50);
    },
    async loadPreviousOutcomes(tokenAddresses) {
      const previous: PonsStoredOutcome[] = [];
      for (let index = 0; index < tokenAddresses.length; index += 100) {
        const { data, error } = await supabase.from('pons_token_outcomes')
          .select('chain,factory_address,token_address,first_market_cap,current_market_cap,peak_market_cap,peak_source,current_source,data_confidence,observation_count,first_observed_at,last_observed_at')
          .eq('chain', 'robinhood').in('token_address', tokenAddresses.slice(index, index + 100));
        if (error) throw new Error(`Pons previous outcome load failed: ${error.message}`);
        for (const row of data ?? []) previous.push({ chain: row.chain as 'robinhood', factoryAddress: row.factory_address,
          tokenAddress: row.token_address, firstMarketCap: row.first_market_cap, currentMarketCap: row.current_market_cap,
          peakMarketCap: row.peak_market_cap, peakSource: row.peak_source, currentSource: row.current_source,
          dataConfidence: row.data_confidence as PonsStoredOutcome['dataConfidence'], observationCount: row.observation_count,
          firstObservedAt: row.first_observed_at, lastObservedAt: row.last_observed_at });
      }
      return previous;
    },
    async loadHistoricalObservations(tokenAddresses) {
      const rows: ObservationRow[] = [];
      for (let index = 0; index < tokenAddresses.length; index += 100) {
        const { data, error } = await supabase.from('robinhood_observations').select(
          'token_address,first_seen_at,decision_at,market_cap_at_decision,market_cap_1m,market_cap_2m,market_cap_3m,market_cap_5m,market_cap_15m,market_cap_30m,market_cap_1h')
          .in('token_address', tokenAddresses.slice(index, index + 100));
        if (error) throw new Error(`Robinhood historical observation load failed: ${error.message}`);
        rows.push(...((data ?? []) as ObservationRow[]));
      }
      return historicalObservationsFromRobinhoodRows(rows);
    },
    async loadCurrentObservation(launch, signal) {
      const snapshot = await getRobinhoodMarketSnapshot(launch.token_address, { caller: 'pons_outcome_collector', priority: 'BACKGROUND',
        queueWaitTimeoutMs: 10_000, signal });
      if (!snapshot || !Number.isFinite(snapshot.marketCapUsd) || snapshot.marketCapUsd <= 0) return null;
      return { tokenAddress: lower(launch.token_address), marketCap: snapshot.marketCapUsd,
        observedAt: snapshot.fetchedAt ?? new Date(snapshot.timestamp).toISOString(), kind: 'CURRENT', source: 'DEXSCREENER_ROBINHOOD_CURRENT' };
    },
    async writeOutcomes(outcomes) {
      const rows = outcomes.map(row => ({ chain: row.chain, factory_address: row.factoryAddress,
        protocol_version: row.protocolVersion, token_address: row.tokenAddress, deployer_address: row.deployerAddress,
        launched_at: row.launchedAt, first_market_cap: row.firstMarketCap, current_market_cap: row.currentMarketCap,
        peak_market_cap: row.peakMarketCap, crossed_100k: row.crossed100k, crossed_500k: row.crossed500k,
        crossed_1m: row.crossed1m, crossed_5m: row.crossed5m, crossed_10m: row.crossed10m,
        severe_crash: row.severeCrash, catastrophic_crash: row.catastrophicCrash, observation_count: row.observationCount,
        data_confidence: row.dataConfidence, first_observed_at: row.firstObservedAt, last_observed_at: row.lastObservedAt,
        peak_source: row.peakSource, current_source: row.currentSource, last_checked_at: row.lastCheckedAt }));
      const { error } = await supabase.from('pons_token_outcomes').upsert(rows, { onConflict: 'chain,factory_address,token_address' });
      if (error) throw new Error(`Pons outcome persistence failed: ${error.message}`);
    },
  };
}
