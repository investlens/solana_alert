import {
  getRobinhoodMarketSnapshot,
} from '../chains/robinhood/market.js';

export type TokenOpenTarget = {
  chartUrl?: string;
  tokenUrl: string;
  chartSource?: 'dexscreener' | 'dexscreener_search';
  tokenSource: 'solscan' | 'blockscout' | 'dexscreener_search';
};

type TokenOpenInput = {
  chain?: string | null;
  tokenAddress: string;
};

export function resolveTokenExplorerUrl(
  chainValue: string | null | undefined,
  tokenAddress: string,
): string {
  const chain = String(chainValue ?? '').trim().toLowerCase();
  const encoded = encodeURIComponent(tokenAddress.trim());
  if (chain === 'robinhood' || chain === 'pons') {
    return `https://robinhoodchain.blockscout.com/token/${encoded}`;
  }
  if (chain === 'solana' || !chain) {
    return `https://solscan.io/token/${encoded}`;
  }
  return `https://dexscreener.com/search?q=${encoded}`;
}

/*
 * Smart Token Router
 *
 * Navigation only.
 *
 * This deliberately does NOT affect:
 * - opportunity scoring
 * - PONS discovery
 * - trading
 * - execution
 * - opportunity lifecycle
 *
 * Robinhood / PONS:
 *   1. Prefer the real DexScreener market page when a
 *      usable market snapshot exists.
 *   2. Fall back to Blockscout for tokens that do not
 *      yet have a usable DexScreener market.
 *
 * Other chains:
 *   Expose separate chart and token destinations when the chain has a safe,
 *   known route; otherwise retain DexScreener search as the non-execution
 *   fallback.
 */
export async function resolveTokenOpenTarget(
  input: TokenOpenInput,
): Promise<TokenOpenTarget> {
  const chain =
    String(input.chain ?? '')
      .trim()
      .toLowerCase();

  const tokenAddress =
    input.tokenAddress.trim();

  if (
    chain === 'robinhood' ||
    chain === 'pons'
  ) {
    try {
      const snapshot =
        await getRobinhoodMarketSnapshot(
          tokenAddress,
        );

      if (
        snapshot?.chartUrl &&
        snapshot.priceUsd > 0
      ) {
        return {
          chartUrl: snapshot.chartUrl,
          tokenUrl: resolveTokenExplorerUrl(chain, tokenAddress),
          chartSource: 'dexscreener',
          tokenSource: 'blockscout',
        };
      }
    } catch (error) {
      console.warn(
        '[TOKEN_OPEN_ROUTER] Robinhood market lookup failed; using explorer fallback',
        {
          tokenAddress,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      );
    }

    return {
      tokenUrl: resolveTokenExplorerUrl(chain, tokenAddress),
      tokenSource: 'blockscout',
    };
  }

  if (chain === 'solana' || !chain) {
    return {
      chartUrl: 'https://dexscreener.com/solana/' + encodeURIComponent(tokenAddress),
      tokenUrl: resolveTokenExplorerUrl(chain, tokenAddress),
      chartSource: 'dexscreener',
      tokenSource: 'solscan',
    };
  }

  return {
    chartUrl: 'https://dexscreener.com/search?q=' + encodeURIComponent(tokenAddress),
    tokenUrl: resolveTokenExplorerUrl(chain, tokenAddress),
    chartSource: 'dexscreener_search',
    tokenSource: 'dexscreener_search',
  };
}
