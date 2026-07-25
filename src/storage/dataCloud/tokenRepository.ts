import type { TokenIdentity, TokenLifecycleStatus, TokenMarketSnapshot, TokenRecord } from '../../domain/token.js';
import { supabase } from '../../services/supabase.js';
import { DataCloudError, errorMessage } from './errors.js';

export interface UpsertTokenInput extends TokenIdentity {
  lifecycleStatus?: TokenLifecycleStatus;
  creatorWallet?: string | null;
  firstSeenAt?: string;
  lastSeenAt?: string;
  launchedAt?: string | null;
  migratedAt?: string | null;
  latestSnapshot?: TokenMarketSnapshot | null;
  metadata?: Record<string, unknown>;
}

interface TokenRow {
  id: string;
  chain: string;
  token_address: string;
  pair_address: string | null;
  symbol: string | null;
  name: string | null;
  creator_wallet: string | null;
  source: string | null;
  status: string;
  first_seen_at: string;
  launched_at: string | null;
  migrated_at: string | null;
  last_seen_at: string;
  current_price: number | null;
  current_market_cap: number | null;
  current_liquidity: number | null;
  current_volume_5m: number | null;
  current_buys_5m: number | null;
  current_sells_5m: number | null;
  holder_count: number | null;
  metadata: Record<string, unknown> | null;
}

const STATUS_TO_DB: Record<string, string> = {
  DISCOVERED: 'discovered',
  WATCHLIST: 'watchlist',
  QUALIFIED: 'active',
  ALERTED: 'alerted',
  MIGRATED: 'migrated',
  ACTIVE: 'active',
  COOLING: 'inactive',
  DEAD: 'dead',
  UNKNOWN: 'unknown',
};

const DB_TO_STATUS: Record<string, TokenLifecycleStatus> = {
  discovered: 'DISCOVERED',
  watchlist: 'WATCHLIST',
  active: 'ACTIVE',
  migrated: 'MIGRATED',
  alerted: 'ALERTED',
  inactive: 'COOLING',
  dead: 'DEAD',
  unknown: 'UNKNOWN',
};

function cleanOptionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toRecord(row: TokenRow): TokenRecord {
  const hasSnapshot = [
    row.current_price,
    row.current_market_cap,
    row.current_liquidity,
    row.current_volume_5m,
    row.current_buys_5m,
    row.current_sells_5m,
    row.holder_count,
  ].some((value) => value !== null && value !== undefined);

  return {
    id: row.id,
    chain: row.chain,
    tokenAddress: row.token_address,
    pairAddress: row.pair_address,
    symbol: row.symbol,
    name: row.name,
    source: row.source,
    lifecycleStatus: DB_TO_STATUS[row.status] ?? 'UNKNOWN',
    creatorWallet: row.creator_wallet,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    launchedAt: row.launched_at,
    migratedAt: row.migrated_at,
    latestSnapshot: hasSnapshot
      ? {
          capturedAt: row.last_seen_at,
          priceUsd: row.current_price,
          marketCapUsd: row.current_market_cap,
          liquidityUsd: row.current_liquidity,
          volume5mUsd: row.current_volume_5m,
          buys5m: row.current_buys_5m,
          sells5m: row.current_sells_5m,
          holderCount: row.holder_count,
        }
      : null,
    metadata: row.metadata ?? {},
  };
}

export class TokenRepository {
  async upsert(input: UpsertTokenInput): Promise<TokenRecord> {
    const now = new Date().toISOString();
    const snapshot = input.latestSnapshot;

    const row = {
      chain: input.chain.toLowerCase(),
      token_address: input.tokenAddress,
      pair_address: cleanOptionalText(input.pairAddress),
      symbol: cleanOptionalText(input.symbol),
      name: cleanOptionalText(input.name),
      creator_wallet: cleanOptionalText(input.creatorWallet),
      source: cleanOptionalText(input.source),
      status: STATUS_TO_DB[input.lifecycleStatus ?? 'DISCOVERED'] ?? 'unknown',
      first_seen_at: input.firstSeenAt ?? now,
      last_seen_at: input.lastSeenAt ?? snapshot?.capturedAt ?? now,
      launched_at: input.launchedAt ?? null,
      migrated_at: input.migratedAt ?? null,
      current_price: snapshot?.priceUsd ?? null,
      current_market_cap: snapshot?.marketCapUsd ?? null,
      current_liquidity: snapshot?.liquidityUsd ?? null,
      current_volume_5m: snapshot?.volume5mUsd ?? null,
      current_buys_5m: snapshot?.buys5m ?? null,
      current_sells_5m: snapshot?.sells5m ?? null,
      holder_count: snapshot?.holderCount ?? null,
      metadata: input.metadata ?? {},
    };

    const { data, error } = await supabase
      .from('tokens')
      .upsert(row, { onConflict: 'chain,token_address' })
      .select('*')
      .single();

    if (error || !data) {
      throw new DataCloudError('token.upsert', errorMessage(error ?? 'No token row returned'), error);
    }

    return toRecord(data as TokenRow);
  }

  async findByAddress(chain: string, tokenAddress: string): Promise<TokenRecord | null> {
    const { data, error } = await supabase
      .from('tokens')
      .select('*')
      .eq('chain', chain.toLowerCase())
      .eq('token_address', tokenAddress)
      .maybeSingle();

    if (error) {
      throw new DataCloudError('token.findByAddress', errorMessage(error), error);
    }

    return data ? toRecord(data as TokenRow) : null;
  }
}

export const tokenRepository = new TokenRepository();
