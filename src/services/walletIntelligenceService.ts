import { supabase } from './supabase.js';

export type AssociatedWalletEvidence = {
  wallet: string;
  distinctLaunches: number;
  transferEvents: number;
  firstSeen: string;
  lastSeen: string;
  evidenceType: 'VERIFIED_DEVELOPER_TOKEN_TRANSFER';
};

export type LaunchSummary = {
  token: string; symbol: string | null; name: string | null; launchedAt: string | null;
  launchVersion: string | null; initialValuation: number | null; peakValuation: number | null;
  currentValuation: number | null; return5m: number | null; return15m: number | null;
  maxReturn: number | null; severeCrash: boolean; catastrophicCrash: boolean;
  milestones: number[]; developerHoldingPercent: number | null; verifiedBurnPercent: number | null;
  developerSellObserved: boolean; developerTransferObserved: boolean; firstSellSeconds: number | null;
};

export type WalletIntelligenceProfile = {
  wallet: string; chain: 'robinhood';
  coverage: { historicalAnalysis: 'NOT_RUN' | 'COMPLETE'; analyzedAt: string | null; fromBlock: string | null; toBlock: string | null; activitiesRecorded: number };
  walletAge: { firstObservedAt: string | null; daysActive: number | null; source: string | null };
  launches: { total: number; recent30d: number; recent7d: number; tokens: LaunchSummary[] };
  launchPerformance: {
    measuredLaunches: number; successfulLaunches: number; severeCrashes: number; catastrophicCrashes: number;
    crossed50k: number; crossed100k: number; crossed250k: number; crossed500k: number; crossed1m: number;
    median5mReturn: number | null; median15mReturn: number | null; medianMaxReturn: number | null;
    bestLaunch: LaunchSummary | null; worstLaunch: LaunchSummary | null;
  };
  developerBehavior: {
    currentHoldingPercent: number | null; verifiedBurnPercent: number | null; observedEarlySells: number;
    observedTransfers: number; launchesWithDevSell: number; launchesWithBurn: number;
    avgTimeToFirstSellSeconds: number | null; associatedWallets: AssociatedWalletEvidence[];
  };
  reputationEvidence: {
    repeatLauncher: boolean; launchCountNegative: boolean; rapidFailurePattern: boolean;
    repeatedEarlySellPattern: boolean; repeatedBurnPattern: boolean; positiveSurvivalPattern: boolean;
    positiveSignals: string[]; negativeSignals: string[]; unknowns: string[];
  };
  dataCompleteness: { launchHistory: boolean; outcomeHistory: boolean; devFlow: boolean; marketHistory: boolean };
};

type LaunchRow = Record<string, unknown>;
type ShadowRow = Record<string, unknown>;
type FlowRow = Record<string, unknown>;

const finite = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const bool = (value: unknown): boolean => value === true;
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const lower = (value: unknown): string => String(value ?? '').toLowerCase();

export function median(values: Array<number | null>): number | null {
  const measured = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!measured.length) return null;
  const middle = Math.floor(measured.length / 2);
  return measured.length % 2 ? measured[middle] : (measured[middle - 1] + measured[middle]) / 2;
}

// Conservative success: a verified +50% max return, or a verified market-cap milestone
// that was strictly above the launch's measured initial valuation.
export function launchHasMeaningfulPerformance(launch: LaunchSummary): boolean {
  if (launch.maxReturn != null && launch.maxReturn >= 50) return true;
  return launch.initialValuation != null && launch.milestones.some(milestone => launch.initialValuation! < milestone);
}

export function buildWalletIntelligenceProfile(args: {
  walletAddress: string; launches: LaunchRow[]; shadows: ShadowRow[]; flows: FlowRow[];
  walletActivityObservedAt?: string[]; activitiesRecorded?: number; analysis?: Record<string, unknown> | null; now?: Date;
}): WalletIntelligenceProfile {
  const wallet = args.walletAddress.toLowerCase();
  const shadowByToken = new Map(args.shadows.map(row => [lower(row.token_address), row]));
  const flowsByToken = new Map<string, FlowRow[]>();
  for (const row of args.flows) {
    const token = lower(row.asset_id);
    if (!flowsByToken.has(token)) flowsByToken.set(token, []);
    flowsByToken.get(token)!.push(row);
  }

  const launches = args.launches.map(row => {
    const token = lower(row.token);
    const shadow = shadowByToken.get(token);
    const flows = flowsByToken.get(token) ?? [];
    const sell = flows.find(flow => text(flow.semantic_event_type) === 'DEV_SELL');
    const transfers = flows.filter(flow => text(flow.semantic_event_type) === 'DEV_TRANSFER');
    const burns = flows.filter(flow => text(flow.semantic_event_type) === 'DEV_BURN');
    const launchedAt = text(row.launched_at) ?? text(shadow?.detected_at);
    const sellAt = text(sell?.alerted_at);
    const firstSellSeconds = launchedAt && sellAt
      ? Math.max(0, Math.floor((Date.parse(sellAt) - Date.parse(launchedAt)) / 1000))
      : null;
    const milestonePairs: Array<[string, number]> = [
      ['crossed_50k', 50_000], ['crossed_100k', 100_000], ['crossed_250k', 250_000],
      ['crossed_500k', 500_000], ['crossed_1m', 1_000_000],
    ];
    const burnValues = burns.map(flow => finite(flow.burned_percent) ?? finite((flow.raw_snapshot as Record<string, unknown> | null)?.movedPercentOfSupply));
    const holdingValues = [finite(shadow?.dev_holding_percent), finite(row.dev_holding_percent)].filter((value): value is number => value != null);
    return {
      token, symbol: text(row.symbol), name: text(row.name), launchedAt,
      launchVersion: text(shadow?.launch_version) ?? text(row.launch_version), initialValuation: finite(row.initial_market_cap),
      peakValuation: finite(row.peak_market_cap), currentValuation: finite(row.current_market_cap),
      return5m: finite(row.return_5m_pct), return15m: finite(row.return_15m_pct), maxReturn: finite(row.max_return_pct),
      severeCrash: bool(row.severe_crash), catastrophicCrash: bool(row.catastrophic_crash),
      milestones: milestonePairs.filter(([key]) => bool(row[key])).map(([, value]) => value),
      developerHoldingPercent: holdingValues.length ? holdingValues[0] : null,
      verifiedBurnPercent: burnValues.filter((value): value is number => value != null).reduce<number | null>((max, value) => max == null || value > max ? value : max, null),
      developerSellObserved: Boolean(sell), developerTransferObserved: transfers.length > 0, firstSellSeconds,
    } satisfies LaunchSummary;
  }).sort((a, b) => Date.parse(b.launchedAt ?? '') - Date.parse(a.launchedAt ?? ''));

  const associations = new Map<string, { tokens: Set<string>; events: number; first: string; last: string }>();
  for (const flow of args.flows.filter(row => text(row.semantic_event_type) === 'DEV_TRANSFER')) {
    const raw = (flow.raw_snapshot as Record<string, unknown> | null) ?? {};
    const destinations = Array.isArray(raw.destinations) ? raw.destinations : [];
    const observedAt = text(flow.alerted_at);
    if (!observedAt) continue;
    for (const destinationRaw of destinations) {
      const destination = lower(destinationRaw);
      if (!/^0x[0-9a-f]{40}$/.test(destination) || destination === wallet ||
          destination === '0x0000000000000000000000000000000000000000' || destination === '0x000000000000000000000000000000000000dead') continue;
      const current = associations.get(destination) ?? { tokens: new Set<string>(), events: 0, first: observedAt, last: observedAt };
      current.tokens.add(lower(flow.asset_id)); current.events += 1;
      if (observedAt < current.first) current.first = observedAt;
      if (observedAt > current.last) current.last = observedAt;
      associations.set(destination, current);
    }
  }
  const associatedWallets = [...associations].map(([address, value]) => ({
    wallet: address, distinctLaunches: value.tokens.size, transferEvents: value.events,
    firstSeen: value.first, lastSeen: value.last, evidenceType: 'VERIFIED_DEVELOPER_TOKEN_TRANSFER' as const,
  })).filter(value => value.transferEvents >= 2)
    .sort((a, b) => b.distinctLaunches - a.distinctLaunches || b.transferEvents - a.transferEvents);

  const now = args.now ?? new Date();
  const observedCandidates: Array<{ at: string; source: string }> = [];
  for (const launch of launches) if (launch.launchedAt) observedCandidates.push({ at: launch.launchedAt, source: 'VERIFIED_CREATOR_LAUNCH' });
  for (const flow of args.flows) {
    const at = text(flow.alerted_at);
    if (at && Number.isFinite(Date.parse(at))) observedCandidates.push({ at, source: 'VERIFIED_DEVELOPER_FLOW' });
  }
  for (const at of args.walletActivityObservedAt ?? []) if (Number.isFinite(Date.parse(at))) observedCandidates.push({ at, source: 'TRACKED_WALLET_ACTIVITY' });
  observedCandidates.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const first = observedCandidates[0] ?? null;
  const sellLaunches = launches.filter(launch => launch.developerSellObserved);
  const burnLaunches = launches.filter(launch => launch.verifiedBurnPercent != null);
  const transferLaunches = launches.filter(launch => launch.developerTransferObserved);
  const measured = launches.filter(launch => launch.maxReturn != null || launch.milestones.length || launch.severeCrash || launch.catastrophicCrash);
  const successful = launches.filter(launchHasMeaningfulPerformance);
  const severe = launches.filter(launch => launch.severeCrash).length;
  const catastrophic = launches.filter(launch => launch.catastrophicCrash).length;
  const positiveSignals: string[] = [];
  const negativeSignals: string[] = [];
  const unknowns: string[] = [];
  if (successful.length) positiveSignals.push(`${successful.length} launch(es) showed verified +50% return or a new material market-cap milestone.`);
  if (launches.length > 3) negativeSignals.push(`${launches.length} verified launches observed; more than 3 is repeat-launch history evidence.`);
  if (severe >= 2) negativeSignals.push(`${severe} launches have verified severe-crash evidence.`);
  if (sellLaunches.length >= 2) negativeSignals.push(`${sellLaunches.length} launches have verified developer-sell events.`);
  if (!launches.length) unknowns.push('No verified creator launches are recorded for this wallet.');
  if (launches.length && !measured.length) unknowns.push('Launch outcome history has not been measured.');
  if (!args.flows.length) unknowns.push('No durable developer-flow events are recorded.');
  const holdingValues = launches.map(launch => launch.developerHoldingPercent).filter((value): value is number => value != null);
  const burnValues = launches.map(launch => launch.verifiedBurnPercent).filter((value): value is number => value != null);
  const sellTimes = sellLaunches.map(launch => launch.firstSellSeconds).filter((value): value is number => value != null);
  const countMilestone = (value: number) => launches.filter(launch => launch.milestones.includes(value)).length;
  const byMax = launches.filter(launch => launch.maxReturn != null).sort((a, b) => b.maxReturn! - a.maxReturn!);

  return {
    wallet, chain: 'robinhood',
    coverage: {
      historicalAnalysis: args.analysis ? 'COMPLETE' : 'NOT_RUN', analyzedAt: text(args.analysis?.analyzedAt),
      fromBlock: text(args.analysis?.fromBlock), toBlock: text(args.analysis?.toBlock), activitiesRecorded: args.activitiesRecorded ?? (args.walletActivityObservedAt?.length ?? 0),
    },
    walletAge: { firstObservedAt: first?.at ?? null, daysActive: first ? Math.max(0, Math.floor((now.getTime() - Date.parse(first.at)) / 86_400_000)) : null, source: first?.source ?? null },
    launches: { total: launches.length, recent30d: launches.filter(row => row.launchedAt && now.getTime() - Date.parse(row.launchedAt) <= 30 * 86_400_000).length, recent7d: launches.filter(row => row.launchedAt && now.getTime() - Date.parse(row.launchedAt) <= 7 * 86_400_000).length, tokens: launches },
    launchPerformance: { measuredLaunches: measured.length, successfulLaunches: successful.length, severeCrashes: severe, catastrophicCrashes: catastrophic,
      crossed50k: countMilestone(50_000), crossed100k: countMilestone(100_000), crossed250k: countMilestone(250_000), crossed500k: countMilestone(500_000), crossed1m: countMilestone(1_000_000),
      median5mReturn: median(launches.map(row => row.return5m)), median15mReturn: median(launches.map(row => row.return15m)), medianMaxReturn: median(launches.map(row => row.maxReturn)), bestLaunch: byMax[0] ?? null, worstLaunch: byMax.length ? byMax[byMax.length - 1] : null },
    developerBehavior: { currentHoldingPercent: holdingValues[0] ?? null, verifiedBurnPercent: burnValues.length ? Math.max(...burnValues) : null,
      observedEarlySells: sellLaunches.filter(row => row.firstSellSeconds != null && row.firstSellSeconds <= 15 * 60).length,
      observedTransfers: transferLaunches.length, launchesWithDevSell: sellLaunches.length, launchesWithBurn: burnLaunches.length,
      avgTimeToFirstSellSeconds: sellTimes.length ? sellTimes.reduce((sum, value) => sum + value, 0) / sellTimes.length : null, associatedWallets },
    reputationEvidence: { repeatLauncher: launches.length > 3, launchCountNegative: launches.length > 3,
      rapidFailurePattern: severe >= 2, repeatedEarlySellPattern: sellLaunches.length >= 2, repeatedBurnPattern: burnLaunches.length >= 2,
      positiveSurvivalPattern: successful.length >= 2, positiveSignals, negativeSignals, unknowns },
    dataCompleteness: { launchHistory: launches.length > 0, outcomeHistory: measured.length > 0, devFlow: args.flows.length > 0,
      marketHistory: launches.some(row => row.initialValuation != null || row.peakValuation != null || row.currentValuation != null) },
  };
}

export async function getWalletIntelligenceProfile(args: { walletAddress: string; chain: 'robinhood' }): Promise<WalletIntelligenceProfile> {
  const wallet = args.walletAddress.toLowerCase();
  const [launchResult, analysisResult, activityCountResult] = await Promise.all([
    supabase.from('creator_launches').select('*').eq('chain', 'robinhood').ilike('creator_wallet', wallet).order('launched_at', { ascending: false }).limit(100),
    supabase.from('wallet_intelligence_analyses').select('result').eq('chain', 'robinhood').eq('wallet_address', wallet).eq('status', 'COMPLETE').maybeSingle(),
    supabase.from('wallet_activity_deliveries').select('id', { count: 'exact', head: true }).ilike('wallet_address', wallet),
  ]);
  const { data: launches, error: launchError } = launchResult;
  if (launchError) throw launchError;
  if (analysisResult.error) throw analysisResult.error;
  if (activityCountResult.error) throw activityCountResult.error;
  const analysis = (analysisResult.data?.result as Record<string, unknown> | null) ?? null;
  const discovered = Array.isArray(analysis?.launches) ? analysis.launches as Array<Record<string, unknown>> : [];
  const mergedLaunches = [...(launches ?? [])];
  const known = new Set(mergedLaunches.map(row => lower(row.token)));
  for (const row of discovered) if (!known.has(lower(row.token))) mergedLaunches.push({ token: row.token, launch_version: row.launchVersion, launched_at: row.launchedAt ?? null });
  const tokens = mergedLaunches.map(row => lower(row.token)).filter(Boolean);
  const tokenSet = new Set(tokens);
  const [shadowResult, flowResult, activityResult] = await Promise.all([
    tokens.length ? supabase.from('pons_shadow_trades').select('token_address,launch_version,detected_at,dev_holding_percent,dev_first_movement_at').ilike('deployer_address', wallet).limit(200) : Promise.resolve({ data: [], error: null }),
    tokens.length ? supabase.from('alpha_alert_events').select('asset_id,semantic_event_type,alerted_at,burned_percent,developer_transferred_percent,raw_snapshot').eq('chain', 'robinhood').in('semantic_event_type', ['DEV_SELL', 'DEV_TRANSFER', 'DEV_BURN']).order('alerted_at', { ascending: false }).limit(1000) : Promise.resolve({ data: [], error: null }),
    supabase.from('wallet_activity_deliveries').select('created_at').ilike('wallet_address', wallet).order('created_at', { ascending: true }).limit(1),
  ]);
  if (shadowResult.error) throw shadowResult.error;
  if (flowResult.error) throw flowResult.error;
  if (activityResult.error) throw activityResult.error;
  return buildWalletIntelligenceProfile({ walletAddress: wallet, launches: mergedLaunches, shadows: (shadowResult.data ?? []).filter(row => tokenSet.has(lower(row.token_address))), flows: (flowResult.data ?? []).filter(row => tokenSet.has(lower(row.asset_id))), walletActivityObservedAt: (activityResult.data ?? []).map(row => String(row.created_at)), activitiesRecorded: activityCountResult.count ?? 0, analysis });
}
