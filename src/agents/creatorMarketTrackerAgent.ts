import { supabase } from '../services/supabase.js';
import { enrichTokenByMintAddress } from '../services/dexscreener.js';
import { markProvenCreator } from '../core/creatorIntelStore.js';

type CreatorLaunchRow = {
  creator_wallet: string | null;
  token: string;
  symbol: string | null;
  peak_market_cap: number | null;
};

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isPumpToken(token: string) {
  return token.endsWith('pump');
}

function isBlockedSymbol(symbol?: string | null) {
  const s = (symbol ?? '').trim().toUpperCase();

  return [
    'USDC',
    'USDT',
    'SOL',
    'WSOL',
    'BTC',
    'ETH',
    'WETH',
    'BONK',
    'JUP',
    'RAY',
  ].includes(s);
}

export async function runCreatorMarketTracker() {
  const { data, error } = await supabase
    .from('creator_launches')
    .select('creator_wallet, token, symbol, peak_market_cap')
    .eq('crossed_1m', false)
    .gte(
      'launched_at',
      new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    )
    .order('last_checked_at', { ascending: true })
    .limit(10);

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
      console.log('creator market tracker skipped non-pump/blocked token:', {
        token: row.token,
        symbol: row.symbol,
      });

      await supabase
        .from('creator_launches')
        .update({
          last_checked_at: new Date().toISOString(),
          crossed_1m: false,
        })
        .eq('token', row.token);

      continue;
    }

    try {
      const enriched = await enrichTokenByMintAddress(row.token);
      const result = enriched?.result;

      const currentMarketCap = num(result?.marketCap);
      const previousPeak = num(row.peak_market_cap);
      const peakMarketCap = Math.max(previousPeak, currentMarketCap);
      const crossed1m = peakMarketCap >= 1_000_000;

      const { error: updateError } = await supabase
        .from('creator_launches')
        .update({
          current_market_cap: currentMarketCap || null,
          peak_market_cap: peakMarketCap || null,
          crossed_1m: crossed1m,
          last_checked_at: new Date().toISOString(),
        })
        .eq('token', row.token);

      if (updateError) {
        console.log('creator market tracker update error:', {
          token: row.token,
          error: updateError,
        });
        continue;
      }

      console.log('creator launch market updated:', {
        token: row.token,
        symbol: row.symbol,
        currentMarketCap,
        peakMarketCap,
        crossed1m,
      });

      if (crossed1m && row.creator_wallet) {
        await markProvenCreator({
          creatorWallet: row.creator_wallet,
          bestToken: row.token,
          bestSymbol: row.symbol,
          bestMarketCap: peakMarketCap,
        });

        console.log('creator promoted to proven:', {
          creator: row.creator_wallet,
          token: row.token,
          symbol: row.symbol,
          peakMarketCap,
        });
      }
    } catch (err) {
      console.log('creator market tracker token error:', {
        token: row.token,
        error: err instanceof Error ? err.message : String(err),
      });

      await supabase
        .from('creator_launches')
        .update({
          last_checked_at: new Date().toISOString(),
        })
        .eq('token', row.token);
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}