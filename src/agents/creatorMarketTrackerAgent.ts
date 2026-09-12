import { supabase } from '../services/supabase.js';
import { enrichTokenByMintAddress } from '../services/dexscreener.js';
import { markProvenCreator } from '../core/creatorIntelStore.js';
import { fetchDexscreenerPairMarketCap } from '../services/dexscreenerPairs.js';

type CreatorLaunchRow = {
  creator_wallet: string | null;
  token: string;
  symbol: string | null;
  peak_market_cap: number | null;
  crossed_500k: boolean | null;
  crossed_1m: boolean | null;
};

const REPUTED_CREATOR_THRESHOLD = 500_000;
const ELITE_CREATOR_THRESHOLD = 1_000_000;

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPumpToken(token: string): boolean {
  return token.endsWith('pump');
}

function isBlockedSymbol(symbol?: string | null): boolean {
  const normalisedSymbol = (symbol ?? '').trim().toUpperCase();
  return ['USDC', 'USDT', 'SOL', 'WSOL', 'BTC', 'ETH', 'WETH', 'BONK', 'JUP', 'RAY'].includes(normalisedSymbol);
}

function creatorGradeFromMarketCap(peakMarketCap: number): string {
  if (peakMarketCap >= 5_000_000) return 'S+';
  if (peakMarketCap >= ELITE_CREATOR_THRESHOLD) return 'S';
  if (peakMarketCap >= REPUTED_CREATOR_THRESHOLD) return 'A';
  return 'UNRATED';
}

export async function runCreatorMarketTracker(): Promise<void> {
  const { data, error } = await supabase
    .from('creator_launches')
    .select(`creator_wallet, token, symbol, peak_market_cap, crossed_500k, crossed_1m`)
    .eq('crossed_1m', false)
    .order('last_checked_at', { ascending: true, nullsFirst: true })
    .limit(25);

  if (error) {
    console.log('creator market tracker fetch error:', error);
    return;
  }

  const rows = (data ?? []) as CreatorLaunchRow[];
  if (!rows.length) {
    console.log('creator market tracker: no launches to check');
    return;
  }

  console.log('creator market tracker checking:', rows.length);

  for (const row of rows) {
    if (!row.token) continue;

    if (!isPumpToken(row.token) || isBlockedSymbol(row.symbol)) {
      console.log('creator market tracker skipped non-pump/blocked token:', { token: row.token, symbol: row.symbol });
      const { error: skippedUpdateError } = await supabase
        .from('creator_launches')
        .update({ last_checked_at: new Date().toISOString() })
        .eq('token', row.token);
      if (skippedUpdateError) console.log('creator skipped-token update error:', { token: row.token, error: skippedUpdateError });
      continue;
    }

    try {
      const enriched = await enrichTokenByMintAddress(row.token);
      const result = enriched?.result;
      let currentMarketCap = num(result?.marketCap);

      console.log('creator enrichment result:', { token: row.token, symbol: row.symbol, dexMarketCap: result?.marketCap ?? null });

      if (!currentMarketCap) {
        currentMarketCap = num(await fetchDexscreenerPairMarketCap(row.token));
        console.log('creator pair fallback:', { token: row.token, pairMarketCap: currentMarketCap });
      }

      // Bitquery is intentionally no longer part of the production critical path.
      // PumpPortal records launches immediately; DexScreener enriches market cap once
      // a usable market/pair exists. Missing market cap remains null/0 and is retried.
      console.log('creator final market cap:', { token: row.token, finalMarketCap: currentMarketCap, source: 'DEXSCREENER' });

      const previousPeakMarketCap = num(row.peak_market_cap);
      const peakMarketCap = Math.max(previousPeakMarketCap, currentMarketCap);
      const crossed50k = peakMarketCap >= 50_000;
      const crossed100k = peakMarketCap >= 100_000;
      const crossed250k = peakMarketCap >= 250_000;
      const crossed500k = peakMarketCap >= REPUTED_CREATOR_THRESHOLD;
      const crossed1m = peakMarketCap >= ELITE_CREATOR_THRESHOLD;
      const creatorGrade = creatorGradeFromMarketCap(peakMarketCap);
      const newlyCrossed500k = crossed500k && row.crossed_500k !== true;
      const newlyCrossed1m = crossed1m && row.crossed_1m !== true;

      const { error: updateError } = await supabase
        .from('creator_launches')
        .update({
          current_market_cap: currentMarketCap || null,
          peak_market_cap: peakMarketCap || null,
          crossed_50k: crossed50k,
          crossed_100k: crossed100k,
          crossed_250k: crossed250k,
          crossed_500k: crossed500k,
          crossed_1m: crossed1m,
          last_checked_at: new Date().toISOString(),
        })
        .eq('token', row.token);

      if (updateError) {
        console.log('creator market tracker update error:', { token: row.token, error: updateError });
        continue;
      }

      console.log('creator launch market updated:', { token: row.token, symbol: row.symbol, currentMarketCap, peakMarketCap, creatorGrade, crossed500k, crossed1m });

      if (crossed500k && row.creator_wallet) {
        await markProvenCreator({ creatorWallet: row.creator_wallet, bestToken: row.token, bestSymbol: row.symbol, bestMarketCap: peakMarketCap });
        console.log(newlyCrossed500k ? 'creator promoted to reputed:' : 'reputed creator record refreshed:', {
          creator: row.creator_wallet, token: row.token, symbol: row.symbol, peakMarketCap, creatorGrade,
        });
      }

      if (newlyCrossed1m && row.creator_wallet) {
        console.log('creator reached elite milestone:', { creator: row.creator_wallet, token: row.token, symbol: row.symbol, peakMarketCap, creatorGrade, milestone: ELITE_CREATOR_THRESHOLD });
      }
    } catch (err) {
      console.log('creator market tracker token error:', { token: row.token, error: err instanceof Error ? err.message : String(err) });
      const { error: retryUpdateError } = await supabase
        .from('creator_launches')
        .update({ last_checked_at: new Date().toISOString() })
        .eq('token', row.token);
      if (retryUpdateError) console.log('creator market tracker retry timestamp error:', { token: row.token, error: retryUpdateError });
    }

    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
}
