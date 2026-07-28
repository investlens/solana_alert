import { supabase } from '../services/supabase.js';
import { enrichTokenByMintAddress } from '../services/dexscreener.js';
import { upsertTokenMemory } from '../memory/tokenMemory.js';
import { recordTokenMemoryEvent } from '../memory/tokenMemoryEvents.js';
import { getCreatorWalletForToken } from '../profiles/tokenCreatorLookup.js';

type MemoryRow = {
  token: string;
  chain: string | null;
  symbol: string | null;
  last_updated: string | null;
};

const POLL_MS = Number(process.env.MEMORY_TRACKER_POLL_MS ?? 10 * 60 * 1000);
const BATCH_SIZE = Number(process.env.MEMORY_TRACKER_BATCH_SIZE ?? 15);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function classifyOutcome(marketCap: number | null, liquidity: number | null) {
  if (!marketCap || marketCap <= 0) return 'TRACKING';
  if (marketCap >= 1_000_000) return 'MOONSHOT';
  if (marketCap >= 250_000) return 'SUCCESSFUL';
  if (marketCap >= 50_000) return 'ACTIVE';
  if (liquidity != null && liquidity < 1_000) return 'WEAK_LIQUIDITY';
  return 'TRACKING';
}

async function fetchMemoryBatch(): Promise<MemoryRow[]> {
  const { data, error } = await supabase
    .from('token_memory')
    .select('token, chain, symbol, last_updated')
    .or('status.is.null,status.eq.TRACKING,status.eq.ACTIVE')
    .order('last_updated', { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.log('memory tracker fetch error:', error.message);
    return [];
  }

  return (data ?? []) as MemoryRow[];
}

async function updateToken(row: MemoryRow) {
  const enriched = await enrichTokenByMintAddress(row.token);
  const pair = enriched?.pair;
  const result = enriched?.result;

  if (!pair || !result) {
    await recordTokenMemoryEvent({
      token: row.token,
      chain: row.chain ?? 'solana',
      eventType: 'CHECK_FAILED',
      eventSource: 'MEMORY_TRACKER',
      note: 'No DexScreener pair/enrichment available during memory update',
    });

    return;
  }

  const marketCap = num(result.marketCap);
  const liquidity = num(result.liquidityUsd);
  const price = num(result.currentPrice);
  const outcome = classifyOutcome(marketCap, liquidity);
  const creatorWallet =
    await getCreatorWalletForToken(row.token);

  await upsertTokenMemory({
    token: row.token,
    symbol: pair.baseToken?.symbol ?? row.symbol,
    name: pair.baseToken?.name ?? null,
    chain: row.chain ?? 'solana',
    creatorWallet,
    marketCap,
    liquidity,
    price,
    buys: result.buys5m,
    sells: result.sells5m,
    confidence: result.score,
    riskLevel: result.risk,
    holderScore: result.marketSafetyScore,
    authorityScore: result.authoritySafetyScore,
    raw: {
      source: 'MEMORY_TRACKER',
      outcome,
      dexUrl: pair.url ?? null,
    },
  });

  await supabase
    .from('token_memory')
    .update({
      status: outcome,
      outcome,
      last_updated: new Date().toISOString(),
    })
    .eq('token', row.token);

  await recordTokenMemoryEvent({
    token: row.token,
    chain: row.chain ?? 'solana',
    eventType: 'MEMORY_UPDATE',
    eventSource: 'MEMORY_TRACKER',
    marketCap,
    liquidity,
    price,
    buys: result.buys5m,
    sells: result.sells5m,
    alphaScore: result.score,
    aiConfidence: result.score,
    riskLevel: result.risk,
    holderScore: result.marketSafetyScore,
    note: `${pair.baseToken?.symbol ?? row.token} memory updated → ${outcome}`,
    raw: {
      outcome,
      dexUrl: pair.url ?? null,
    },
  });

  console.log('memory tracker updated:', {
    token: row.token,
    symbol: pair.baseToken?.symbol,
    marketCap,
    liquidity,
    outcome,
  });
}

export async function startMemoryTracker() {
  console.log('Starting Alpha Memory tracker...');

  while (true) {
    try {
      const rows = await fetchMemoryBatch();

      if (!rows.length) {
        console.log('memory tracker: no tokens to update');
      }

      for (const row of rows) {
        try {
          await updateToken(row);
          await sleep(1200);
        } catch (error) {
          console.log('memory tracker token error:', {
            token: row.token,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      console.log('memory tracker loop error:', error);
    }

    await sleep(POLL_MS);
  }
}