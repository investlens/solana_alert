import type { PonsLaunch } from './ponsHistoricalLaunchScanner.js';
import type { PonsLiveRouteResult } from './ponsLiveLaunchRouter.js';

export type PersistedPonsLaunch = {
  token_address: string; deployer_address: string; factory_address: string;
  protocol_version: string; transaction_hash: string; block_number: string | number;
  block_timestamp: string; log_index: number; curve_address?: string | null;
  pool_address?: string | null; pair_token_address?: string | null;
  launch_config_id?: string | number | null; graduation_threshold?: string | number | null;
  initial_buy_amount?: string | number | null;
};
export type PonsLiveReplaySource = {
  loadExactLaunch(tokenAddress: string): Promise<PersistedPonsLaunch | null>;
};

const lower = (value: string) => value.trim().toLowerCase();
const nullable = (value: string | number | null | undefined) => value == null ? null : String(value);

export function reconstructPonsLiveLaunch(row: PersistedPonsLaunch): PonsLaunch {
  return {
    chain: 'robinhood', protocol: 'pons', protocol_version: row.protocol_version,
    token_address: lower(row.token_address), deployer_address: lower(row.deployer_address),
    factory_address: lower(row.factory_address), transaction_hash: lower(row.transaction_hash),
    block_number: String(row.block_number), block_timestamp: row.block_timestamp, log_index: row.log_index,
    curve_address: row.curve_address ? lower(row.curve_address) : null,
    pool_address: row.pool_address ? lower(row.pool_address) : null,
    pair_token_address: row.pair_token_address ? lower(row.pair_token_address) : null,
    launch_config_id: nullable(row.launch_config_id), graduation_threshold: nullable(row.graduation_threshold),
    initial_buy_amount: nullable(row.initial_buy_amount),
  };
}

export async function replayPonsLiveLaunch(
  tokenAddress: string,
  source: PonsLiveReplaySource,
  route: (launch: PonsLaunch) => Promise<PonsLiveRouteResult>,
  log: (line: string) => void = console.log,
): Promise<PonsLiveRouteResult> {
  const token = lower(tokenAddress);
  const row = await source.loadExactLaunch(token);
  if (!row || lower(row.token_address) !== token) throw new Error(`No exact persisted Pons launch found for token ${token}`);
  const launch = reconstructPonsLiveLaunch(row);
  log(`[PonsLiveReplay] token=${launch.token_address}`);
  log(`[PonsLiveReplay] deployer=${launch.deployer_address}`);
  const result = await route(launch);
  log(`[PonsLiveReplay] tier=${result.developerTier}`);
  log(`[PonsLiveReplay] priorityAlert=${result.alertDelivery}`);
  log(`[PonsLiveReplay] validation=${result.validation}`);
  log(`[PonsLiveReplay] momentum=${result.decision?.momentum ?? 'NOT_RUN'}`);
  log(`[PonsLiveReplay] decision=${result.decision?.action === 'BUY' ? 'SHADOW_BUY' : 'IGNORE'}`);
  log('[PonsLiveReplay] liveStateWrites=0 realTrades=0');
  return result;
}

export const supabasePonsLiveReplaySource: PonsLiveReplaySource = {
  async loadExactLaunch(tokenAddress) {
    const { supabase } = await import('../../services/supabase.js');
    const { data, error } = await supabase.from('pons_launches').select([
      'token_address', 'deployer_address', 'factory_address', 'protocol_version',
      'transaction_hash', 'block_number', 'block_timestamp', 'log_index', 'curve_address',
      'pool_address', 'pair_token_address', 'launch_config_id', 'graduation_threshold', 'initial_buy_amount',
    ].join(',')).eq('chain', 'robinhood').eq('token_address', lower(tokenAddress))
      .order('block_number', { ascending: true }).limit(1).maybeSingle();
    if (error) throw new Error(`Pons replay launch lookup failed: ${error.message}`);
    return data as unknown as PersistedPonsLaunch | null;
  },
};
