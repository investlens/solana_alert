import {
  getRobinhoodMarketSnapshot,
} from '../chains/robinhood/market.js';

export type TokenOpenTarget = {
  url: string;
  label: string;
  source:
    | 'dexscreener'
    | 'blockscout'
    | 'dexscreener_search';
};

type TokenOpenInput = {
  chain?: string | null;
  tokenAddress: string;
};

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
 *   Use DexScreener search for now.
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
          url: snapshot.chartUrl,
          label: '📊 OPEN ON DEXSCREENER',
          source: 'dexscreener',
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
      url:
        'https://robinhoodchain.blockscout.com/token/' +
        encodeURIComponent(tokenAddress),
      label: '🔎 OPEN EXPLORER',
      source: 'blockscout',
    };
  }

  return {
    url:
      'https://dexscreener.com/search?q=' +
      encodeURIComponent(tokenAddress),
    label: '🔎 CHECK TOKEN',
    source: 'dexscreener_search',
  };
}
