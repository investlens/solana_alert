import { getAddress, parseAbiItem, type Address } from 'viem';
import { PONS_CONTRACTS } from '../chains/robinhood/ponsContracts.js';
import { robinhoodPublicClient } from '../chains/robinhood/rpc.js';
import { supabase } from './supabase.js';

const v1Launch = parseAbiItem('event TokenLaunched(address indexed token, address indexed deployer, address indexed dexFactory, address pairToken, address pool, uint256 dexId, uint256 launchConfigId, uint256 positionId, uint256 restrictionsEndBlock, uint256 initialBuyAmount)');
const v2Launch = parseAbiItem('event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)');
const V2_EMITTER = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e' as const;
export const WALLET_ANALYSIS_LOOKBACK_BLOCKS = 50_000n;
export const WALLET_ANALYSIS_CHUNK_BLOCKS = 2_500n;
export const WALLET_ANALYSIS_MAX_LAUNCHES = 50;
export const WALLET_ANALYSIS_CACHE_MS = 24 * 60 * 60 * 1_000;
export const WALLET_ANALYSIS_SOURCES = ['PONS_V1', 'PONS_V2'] as const;

export type HistoricalWalletAnalysis = {
  status: 'COMPLETE'; fromBlock: string; toBlock: string; analyzedAt: string;
  coverage: 'KNOWN_PONS_EMITTERS_BOUNDED';
  launchSources: ['PONS_V1', 'PONS_V2'];
  launches: Array<{ token: string; launchVersion: 'PONS_V1' | 'PONS_V2'; blockNumber: string; transactionHash: string; launchedAt: string | null }>;
};

export type WalletAnalysisInvocationResult = {
  status: 'COMPLETE' | 'FAILED'; source: 'CACHE' | 'FRESH'; wallet: string;
  analyzedAt: string | null; fromBlock: bigint | null; toBlock: bigint | null;
  sourcesChecked: Array<(typeof WALLET_ANALYSIS_SOURCES)[number]>;
  launchesFound: number | null; errorStage?: string | null; errorReason?: string | null;
  analysis?: HistoricalWalletAnalysis;
};

export type WalletAnalysisDiagnostics = {
  invocationId: string; telegramId?: string; updateId?: number; callbackQueryId?: string;
  walletId?: number; walletShort?: string;
};

type AnalysisProgress = { fromBlock: bigint | null; toBlock: bigint | null; chunkCount: number; completedChunks: number; stage: string };

class WalletAnalysisStageError extends Error {
  constructor(readonly stage: string, readonly progress: AnalysisProgress, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

export function walletAnalysisCacheIsFresh(analyzedAt: unknown, now = Date.now()): boolean {
  const timestamp = Date.parse(String(analyzedAt ?? ''));
  return Number.isFinite(timestamp) && now - timestamp >= 0 && now - timestamp <= WALLET_ANALYSIS_CACHE_MS;
}

function safeAnalysisFailureReason(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (message.includes('429') || message.includes('rate limit')) return 'RPC rate limit';
  if (message.includes('timeout') || message.includes('timed out')) return 'RPC timeout';
  if (message.includes('network') || message.includes('fetch')) return 'RPC unavailable';
  return 'Analysis dependency unavailable';
}

function analysisLog(event: string, diagnostics: WalletAnalysisDiagnostics | undefined, fields: Record<string, unknown>) {
  console.log('[WalletAnalysis]', { event, ...diagnostics, ...fields });
}

type HistoricalAnalysisRpc = {
  getBlockNumber: () => Promise<bigint>;
  getLogs: typeof robinhoodPublicClient.getLogs;
  getBlock: typeof robinhoodPublicClient.getBlock;
};

type AnalysisCacheRow = { status: string; result: HistoricalWalletAnalysis; analyzed_at: string } | null;
type HistoricalAnalysisCache = {
  read: (wallet: string) => Promise<AnalysisCacheRow>;
  write: (wallet: string, analysis: HistoricalWalletAnalysis) => Promise<void>;
};

const productionAnalysisCache: HistoricalAnalysisCache = {
  async read(wallet) {
    const { data, error } = await supabase.from('wallet_intelligence_analyses')
      .select('status,result,analyzed_at').eq('chain', 'robinhood').eq('wallet_address', wallet).maybeSingle();
    if (error) throw error;
    return data as AnalysisCacheRow;
  },
  async write(wallet, analysis) {
    const { error } = await supabase.from('wallet_intelligence_analyses').upsert({ chain: 'robinhood', wallet_address: wallet,
      status: 'COMPLETE', from_block: analysis.fromBlock, to_block: analysis.toBlock, result: analysis, analyzed_at: analysis.analyzedAt },
    { onConflict: 'chain,wallet_address' });
    if (error) throw error;
  },
};

export async function discoverKnownPonsLaunches(walletAddress: string, rpc: HistoricalAnalysisRpc = robinhoodPublicClient,
  onProgress?: (progress: AnalysisProgress) => void): Promise<HistoricalWalletAnalysis> {
  const wallet = getAddress(walletAddress);
  const progress: AnalysisProgress = { fromBlock: null, toBlock: null, chunkCount: 0, completedChunks: 0, stage: 'HEAD' };
  let head: bigint;
  try { head = await rpc.getBlockNumber(); } catch (error) { throw new WalletAnalysisStageError('HEAD', progress, error); }
  const from = head > WALLET_ANALYSIS_LOOKBACK_BLOCKS ? head - WALLET_ANALYSIS_LOOKBACK_BLOCKS + 1n : 0n;
  progress.fromBlock = from; progress.toBlock = head;
  progress.chunkCount = Number((head - from) / WALLET_ANALYSIS_CHUNK_BLOCKS) + 1;
  onProgress?.({ ...progress });
  const launches: HistoricalWalletAnalysis['launches'] = [];
  for (let chunkFrom = from; chunkFrom <= head; chunkFrom += WALLET_ANALYSIS_CHUNK_BLOCKS) {
    const chunkTo = chunkFrom + WALLET_ANALYSIS_CHUNK_BLOCKS - 1n < head ? chunkFrom + WALLET_ANALYSIS_CHUNK_BLOCKS - 1n : head;
    progress.stage = 'GET_LOGS';
    let v1: any; let v2: any;
    try { [v1, v2] = await Promise.all([
        rpc.getLogs({ address: getAddress(PONS_CONTRACTS.factory), event: v1Launch, args: { deployer: wallet as Address }, fromBlock: chunkFrom, toBlock: chunkTo }),
        rpc.getLogs({ address: getAddress(V2_EMITTER), event: v2Launch, args: { deployer: wallet as Address }, fromBlock: chunkFrom, toBlock: chunkTo }),
      ]); } catch (error) { throw new WalletAnalysisStageError('GET_LOGS', { ...progress }, error); }
    for (const [version, rows] of [['PONS_V1', v1], ['PONS_V2', v2]] as const) {
      for (const log of rows) {
        if (launches.length >= WALLET_ANALYSIS_MAX_LAUNCHES) break;
        if (!log.args.token || !log.transactionHash || log.blockNumber == null) continue;
        launches.push({ token: getAddress(log.args.token), launchVersion: version, blockNumber: log.blockNumber.toString(), transactionHash: log.transactionHash, launchedAt: null });
      }
    }
    progress.completedChunks += 1;
    onProgress?.({ ...progress });
  }
  progress.stage = 'TIMESTAMPS';
  for (let index = 0; index < launches.length; index += 10) {
    const batch = launches.slice(index, index + 10);
    let blocks: Awaited<ReturnType<HistoricalAnalysisRpc['getBlock']>>[];
    try { blocks = await Promise.all(batch.map(launch => rpc.getBlock({ blockNumber: BigInt(launch.blockNumber) }))); }
    catch (error) { throw new WalletAnalysisStageError('TIMESTAMPS', { ...progress }, error); }
    for (let offset = 0; offset < batch.length; offset += 1) batch[offset].launchedAt = new Date(Number(blocks[offset].timestamp) * 1000).toISOString();
  }
  return { status: 'COMPLETE', fromBlock: from.toString(), toBlock: head.toString(), analyzedAt: new Date().toISOString(), coverage: 'KNOWN_PONS_EMITTERS_BOUNDED', launchSources: ['PONS_V1', 'PONS_V2'], launches };
}

export async function analyzeRobinhoodWallet(walletAddress: string, options: { now?: Date; diagnostics?: WalletAnalysisDiagnostics;
  rpc?: HistoricalAnalysisRpc; cache?: HistoricalAnalysisCache } = {}): Promise<WalletAnalysisInvocationResult> {
  const startedAt = Date.now();
  const wallet = getAddress(walletAddress);
  const base = { wallet: wallet.toLowerCase(), sourcesChecked: [...WALLET_ANALYSIS_SOURCES] };
  analysisLog('START', options.diagnostics, { wallet: options.diagnostics?.walletShort ?? `${wallet.slice(0, 6)}…${wallet.slice(-6)}` });
  let cached: AnalysisCacheRow;
  try { cached = await (options.cache ?? productionAnalysisCache).read(wallet.toLowerCase()); }
  catch (error) {
    const result: WalletAnalysisInvocationResult = { ...base, status: 'FAILED', source: 'FRESH', analyzedAt: null, fromBlock: null, toBlock: null, launchesFound: null, errorStage: 'CACHE_READ', errorReason: 'Analysis cache unavailable' };
    analysisLog('FINISH', options.diagnostics, { status: result.status, source: result.source, analyzedAt: null, fromBlock: null, toBlock: null,
      launchesFound: null, failureStage: result.errorStage, failureReason: result.errorReason, sourcesChecked: result.sourcesChecked.join(','), elapsedMs: Date.now() - startedAt });
    return result;
  }
  const cachedAnalysis = cached?.status === 'COMPLETE' ? cached.result as HistoricalWalletAnalysis : null;
  const cacheFresh = cachedAnalysis && walletAnalysisCacheIsFresh(cached.analyzed_at, (options.now ?? new Date()).getTime());
  const cacheDecision = cacheFresh ? 'HIT' : cachedAnalysis ? 'EXPIRED' : cached?.status === 'FAILED' ? 'FAILED' : 'MISS';
  analysisLog('CACHE', options.diagnostics, { cache: cacheDecision, analyzedAt: cached?.analyzed_at ?? null });
  if (cacheFresh && cachedAnalysis) {
    const result: WalletAnalysisInvocationResult = { ...base, status: 'COMPLETE', source: 'CACHE', analyzedAt: cachedAnalysis.analyzedAt,
      fromBlock: BigInt(cachedAnalysis.fromBlock), toBlock: BigInt(cachedAnalysis.toBlock), launchesFound: cachedAnalysis.launches.length, analysis: cachedAnalysis };
    const chunkCount = Number((result.toBlock - result.fromBlock) / WALLET_ANALYSIS_CHUNK_BLOCKS) + 1;
    analysisLog('FINISH', options.diagnostics, { status: result.status, source: result.source, analyzedAt: result.analyzedAt,
      launchesFound: result.launchesFound, fromBlock: result.fromBlock.toString(), toBlock: result.toBlock.toString(), chunkCount,
      completedChunks: chunkCount, sourcesChecked: result.sourcesChecked.join(' · '), elapsedMs: Date.now() - startedAt });
    return result;
  }
  let latest: AnalysisProgress = { fromBlock: null, toBlock: null, chunkCount: 0, completedChunks: 0, stage: 'HEAD' };
  try {
    const analysis = await discoverKnownPonsLaunches(wallet, options.rpc ?? robinhoodPublicClient, progress => {
      latest = progress;
      analysisLog('PROGRESS', options.diagnostics, { fromBlock: progress.fromBlock?.toString() ?? null, toBlock: progress.toBlock?.toString() ?? null,
        chunkCount: progress.chunkCount, completedChunks: progress.completedChunks, sourcesChecked: WALLET_ANALYSIS_SOURCES.join(' · ') });
    });
    try { await (options.cache ?? productionAnalysisCache).write(wallet.toLowerCase(), analysis); }
    catch (error) { throw new WalletAnalysisStageError('CACHE_WRITE', latest, error); }
    const result: WalletAnalysisInvocationResult = { ...base, status: 'COMPLETE', source: 'FRESH', analyzedAt: analysis.analyzedAt,
      fromBlock: BigInt(analysis.fromBlock), toBlock: BigInt(analysis.toBlock), launchesFound: analysis.launches.length, analysis };
    analysisLog('FINISH', options.diagnostics, { status: result.status, source: result.source, fromBlock: analysis.fromBlock, toBlock: analysis.toBlock,
      chunkCount: latest.chunkCount, completedChunks: latest.completedChunks, sourcesChecked: result.sourcesChecked.join(' · '),
      launchesFound: result.launchesFound, elapsedMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    const staged = error instanceof WalletAnalysisStageError ? error : new WalletAnalysisStageError(latest.stage, latest, error);
    const result: WalletAnalysisInvocationResult = { ...base, status: 'FAILED', source: 'FRESH', analyzedAt: null,
      fromBlock: staged.progress.fromBlock, toBlock: staged.progress.toBlock, launchesFound: null, errorStage: staged.stage, errorReason: safeAnalysisFailureReason(staged) };
    analysisLog('FINISH', options.diagnostics, { status: result.status, source: result.source, fromBlock: result.fromBlock?.toString() ?? null,
      toBlock: result.toBlock?.toString() ?? null, chunkCount: staged.progress.chunkCount, completedChunks: staged.progress.completedChunks,
      failureStage: result.errorStage, failureReason: result.errorReason, elapsedMs: Date.now() - startedAt });
    return result;
  }
}
