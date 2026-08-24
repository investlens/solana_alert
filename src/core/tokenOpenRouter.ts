import {
  getRobinhoodMarketSnapshot,
} from '../chains/robinhood/market.js';
import { getRobinhoodTokenMetadata } from '../chains/robinhood/tokenMetadata.js';
import type { NotificationMarketContext } from '../ui/notificationMarketContext.js';

export type TokenOpenTarget = {
  chartUrl?: string;
  tokenUrl: string;
  chartSource?: 'dexscreener' | 'dexscreener_search';
  tokenSource: 'solscan' | 'blockscout' | 'dexscreener_search';
  marketContext?: Partial<NotificationMarketContext> & { priceUsd?: number; priceProvenance?: string };
  marketIndexState?: 'VERIFIED' | 'NOT_INDEXED';
};

type TokenOpenInput = {
  chain?: string | null;
  tokenAddress: string;
  includeMetadataFallback?: boolean;
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
    let marketLookupCompletedWithoutSnapshot = false;
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
          marketContext: {
            symbol: snapshot.symbol,
            name: snapshot.name,
            address: tokenAddress,
            marketCap: snapshot.marketCapUsd,
            fdv: snapshot.fdvUsd,
            liquidity: snapshot.liquidityUsd,
            volume5m: snapshot.volume5mUsd,
            chartUrl: snapshot.chartUrl,
            priceUsd: snapshot.priceUsd,
            priceProvenance: 'DEXSCREENER_VERIFIED_BASE_PAIR',
          },
          marketIndexState: 'VERIFIED',
        };
      }
      marketLookupCompletedWithoutSnapshot = snapshot == null;
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

    if (input.includeMetadataFallback) {
      try {
        const metadata = await Promise.race([
          getRobinhoodTokenMetadata(tokenAddress),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 2_000)),
        ]);
        if (metadata?.symbol || metadata?.name) {
          return {
            tokenUrl: resolveTokenExplorerUrl(chain, tokenAddress),
            tokenSource: 'blockscout',
            marketContext: {
              symbol: metadata.symbol,
              name: metadata.name,
              address: tokenAddress,
            },
            marketIndexState: marketLookupCompletedWithoutSnapshot
              ? 'NOT_INDEXED'
              : undefined,
          };
        }
      } catch (error) {
        console.warn('[TOKEN_OPEN_ROUTER] Robinhood metadata fallback failed', {
          tokenAddress,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      tokenUrl: resolveTokenExplorerUrl(chain, tokenAddress),
      tokenSource: 'blockscout',
      marketIndexState: marketLookupCompletedWithoutSnapshot
        ? 'NOT_INDEXED'
        : undefined,
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
