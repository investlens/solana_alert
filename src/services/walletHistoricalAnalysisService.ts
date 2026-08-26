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

export type HistoricalWalletAnalysis = {
  status: 'COMPLETE'; fromBlock: string; toBlock: string; analyzedAt: string;
  coverage: 'KNOWN_PONS_EMITTERS_BOUNDED';
  launchSources: ['PONS_V1', 'PONS_V2'];
  launches: Array<{ token: string; launchVersion: 'PONS_V1' | 'PONS_V2'; blockNumber: string; transactionHash: string; launchedAt: string | null }>;
};

type HistoricalAnalysisRpc = {
  getBlockNumber: () => Promise<bigint>;
  getLogs: typeof robinhoodPublicClient.getLogs;
  getBlock: typeof robinhoodPublicClient.getBlock;
};

export async function discoverKnownPonsLaunches(walletAddress: string, rpc: HistoricalAnalysisRpc = robinhoodPublicClient): Promise<HistoricalWalletAnalysis> {
  const wallet = getAddress(walletAddress);
  const head = await rpc.getBlockNumber();
  const from = head > WALLET_ANALYSIS_LOOKBACK_BLOCKS ? head - WALLET_ANALYSIS_LOOKBACK_BLOCKS + 1n : 0n;
  const launches: HistoricalWalletAnalysis['launches'] = [];
  for (let chunkFrom = from; chunkFrom <= head && launches.length < WALLET_ANALYSIS_MAX_LAUNCHES; chunkFrom += WALLET_ANALYSIS_CHUNK_BLOCKS) {
    const chunkTo = chunkFrom + WALLET_ANALYSIS_CHUNK_BLOCKS - 1n < head ? chunkFrom + WALLET_ANALYSIS_CHUNK_BLOCKS - 1n : head;
    const [v1, v2] = await Promise.all([
      rpc.getLogs({ address: getAddress(PONS_CONTRACTS.factory), event: v1Launch, args: { deployer: wallet as Address }, fromBlock: chunkFrom, toBlock: chunkTo }),
      rpc.getLogs({ address: getAddress(V2_EMITTER), event: v2Launch, args: { deployer: wallet as Address }, fromBlock: chunkFrom, toBlock: chunkTo }),
    ]);
    for (const [version, rows] of [['PONS_V1', v1], ['PONS_V2', v2]] as const) {
      for (const log of rows) {
        if (!log.args.token || !log.transactionHash || log.blockNumber == null) continue;
        launches.push({ token: getAddress(log.args.token), launchVersion: version, blockNumber: log.blockNumber.toString(), transactionHash: log.transactionHash, launchedAt: null });
        if (launches.length >= WALLET_ANALYSIS_MAX_LAUNCHES) break;
      }
    }
  }
  for (let index = 0; index < launches.length; index += 10) {
    const batch = launches.slice(index, index + 10);
    const blocks = await Promise.all(batch.map(launch => rpc.getBlock({ blockNumber: BigInt(launch.blockNumber) })));
    for (let offset = 0; offset < batch.length; offset += 1) batch[offset].launchedAt = new Date(Number(blocks[offset].timestamp) * 1000).toISOString();
  }
  return { status: 'COMPLETE', fromBlock: from.toString(), toBlock: head.toString(), analyzedAt: new Date().toISOString(), coverage: 'KNOWN_PONS_EMITTERS_BOUNDED', launchSources: ['PONS_V1', 'PONS_V2'], launches };
}

export async function analyzeRobinhoodWallet(walletAddress: string): Promise<HistoricalWalletAnalysis> {
  const wallet = getAddress(walletAddress);
  const { data: cached, error: cacheError } = await supabase.from('wallet_intelligence_analyses')
    .select('result,analyzed_at').eq('chain', 'robinhood').eq('wallet_address', wallet.toLowerCase()).eq('status', 'COMPLETE').maybeSingle();
  if (cacheError) throw cacheError;
  if (cached && Date.now() - Date.parse(String(cached.analyzed_at)) < WALLET_ANALYSIS_CACHE_MS) {
    return cached.result as HistoricalWalletAnalysis;
  }
  const result = await discoverKnownPonsLaunches(wallet);
  const { error } = await supabase.from('wallet_intelligence_analyses').upsert({ chain: 'robinhood', wallet_address: wallet.toLowerCase(), status: 'COMPLETE', from_block: result.fromBlock, to_block: result.toBlock, result, analyzed_at: result.analyzedAt }, { onConflict: 'chain,wallet_address' });
  if (error) throw error;
  return result;
}
