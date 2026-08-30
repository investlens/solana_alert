import { governedDexScreenerJson } from './dexscreenerRequestGovernor.js';

type DexScreenerPair = {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;

  baseToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };

  quoteToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };

  liquidity?: {
    usd?: number | string | null;
  } | null;

  volume?: {
    h24?: number | string | null;
  };

  marketCap?: number | string | null;
  fdv?: number | string | null;
  pairCreatedAt?: number | null;
};

function toPositiveNumber(value: unknown): number | null {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }

  return numberValue;
}

export async function fetchDexscreenerPairMarketCap(
  token: string
): Promise<number | null> {
  const normalisedToken = token?.trim();

  if (!normalisedToken) {
    return null;
  }

  try {
    const url =
      `https://api.dexscreener.com/token-pairs/v1/solana/` +
      encodeURIComponent(normalisedToken);

    const response = (await governedDexScreenerJson<unknown>({ url, caller: 'creator_market_fallback', priority: 'BACKGROUND',
      endpoint: 'TOKEN_PAIRS_SOLANA', cacheKey: `solana:${normalisedToken.toLowerCase()}`, cacheTtlMs: 60_000,
      signal: AbortSignal.timeout(10_000) })).value;

    if (!Array.isArray(response) || response.length === 0) {
      console.log('dexscreener returned no pairs:', {
        token: normalisedToken,
      });

      return null;
    }

    const matchingPairs = (response as DexScreenerPair[]).filter((pair) => {
      if (pair?.chainId && pair.chainId !== 'solana') {
        return false;
      }

      const baseAddress = pair?.baseToken?.address?.trim();
      const quoteAddress = pair?.quoteToken?.address?.trim();

      return (
        baseAddress === normalisedToken ||
        quoteAddress === normalisedToken
      );
    });

    if (matchingPairs.length === 0) {
      console.log('dexscreener returned no matching token pair:', {
        token: normalisedToken,
        receivedPairs: response.length,
      });

      return null;
    }

    /*
     * Prefer pairs that:
     * 1. Have a real marketCap
     * 2. Have an FDV fallback
     * 3. Have stronger liquidity
     * 4. Have stronger 24-hour volume
     */
    const rankedPairs = matchingPairs
      .map((pair) => {
        const marketCap = toPositiveNumber(pair.marketCap);
        const fdv = toPositiveNumber(pair.fdv);
        const liquidity = toPositiveNumber(pair.liquidity?.usd) ?? 0;
        const volume24h = toPositiveNumber(pair.volume?.h24) ?? 0;

        const valuationScore =
          marketCap !== null ? 2 : fdv !== null ? 1 : 0;

        return {
          pair,
          marketCap,
          fdv,
          liquidity,
          volume24h,
          valuationScore,
        };
      })
      .filter((item) => item.marketCap !== null || item.fdv !== null)
      .sort((a, b) => {
        if (b.valuationScore !== a.valuationScore) {
          return b.valuationScore - a.valuationScore;
        }

        if (b.liquidity !== a.liquidity) {
          return b.liquidity - a.liquidity;
        }

        return b.volume24h - a.volume24h;
      });

    const best = rankedPairs[0];

    if (!best) {
      console.log('dexscreener pairs have no valuation:', {
        token: normalisedToken,
        matchingPairCount: matchingPairs.length,
      });

      return null;
    }

    const finalMarketCap = best.marketCap ?? best.fdv;
    const valuationSource =
      best.marketCap !== null ? 'marketCap' : 'fdv';

    console.log('dexscreener market cap resolved:', {
      token: normalisedToken,
      pairAddress: best.pair.pairAddress ?? null,
      dexId: best.pair.dexId ?? null,
      pairCount: matchingPairs.length,
      liquidity: best.liquidity,
      marketCap: best.marketCap,
      fdv: best.fdv,
      finalMarketCap,
      valuationSource,
    });

    return finalMarketCap;
  } catch (err) {
    console.log('dexscreener pairs market cap error:', {
      token: normalisedToken,
      error: err instanceof Error ? err.message : String(err),
    });

    return null;
  }
}
