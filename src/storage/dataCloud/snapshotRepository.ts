import type { AIConviction } from '../../domain/conviction.js';
import type { TokenIdentity, TokenMarketSnapshot } from '../../domain/token.js';
import { supabase } from '../../services/supabase.js';
import { DataCloudError, errorMessage } from './errors.js';

export interface CreateTokenSnapshotInput {
  token: TokenIdentity;
  tokenId?: string | null;
  reason: string;
  market: TokenMarketSnapshot;
  conviction?: AIConviction | null;
  snapshot?: Record<string, unknown>;
}

export class SnapshotRepository {
  async create(input: CreateTokenSnapshotInput): Promise<string> {
    const { market, conviction } = input;
    const row = {
      chain: input.token.chain.toLowerCase(),
      token_id: input.tokenId ?? null,
      token_address: input.token.tokenAddress,
      snapshot_reason: input.reason,
      observed_at: market.capturedAt,
      price: market.priceUsd ?? null,
      market_cap: market.marketCapUsd ?? null,
      liquidity: market.liquidityUsd ?? null,
      volume_5m: market.volume5mUsd ?? null,
      buys_5m: market.buys5m ?? null,
      sells_5m: market.sells5m ?? null,
      holder_count: market.holderCount ?? null,
      top_10_holder_percent: market.top10HolderPercentage ?? null,
      developer_percent: market.developerHoldingPercentage ?? null,
      bundled_percent: market.bundledSupplyPercentage ?? null,
      opportunity_score: conviction?.opportunityScore ?? null,
      confidence_score: conviction?.confidenceScore ?? null,
      risk_score: conviction?.riskScore ?? null,
      snapshot: input.snapshot ?? {},
    };

    const { data, error } = await supabase
      .from('token_snapshots')
      .insert(row)
      .select('id')
      .single();

    if (error || !data) {
      throw new DataCloudError('snapshot.create', errorMessage(error ?? 'No snapshot row returned'), error);
    }

    return String(data.id);
  }
}

export const snapshotRepository = new SnapshotRepository();
