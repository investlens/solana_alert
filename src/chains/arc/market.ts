import { governedDexScreenerJson } from '../../services/dexscreenerRequestGovernor.js';
import type { ArcTokenEnrichment } from './enrichment.js';
import { ARC_USDC_ADDRESS } from './config.js';

export type ArcMarketEnrichment = ArcTokenEnrichment & {
  marketDataSource: 'DEXSCREENER' | null;
  liquidityUsd: number | null;
  volume5mUsd: number | null;
  buys5m: number | null;
  sells5m: number | null;
  marketCapUsd: number | null;
  priceUsd: number | null;
  pairCreatedAt: number | null;
  dexUrl: string | null;
  projectWebsite: string | null;
  projectTwitter: string | null;
  projectTelegram: string | null;
};

type Pair = {
  chainId?: string;
  pairAddress?: string;
  baseToken?: { address?: string };
  quoteToken?: { address?: string };
  liquidity?: { usd?: number | string | null };
  volume?: { m5?: number | string | null };
  txns?: { m5?: { buys?: number | string | null; sells?: number | string | null } };
  marketCap?: number | string | null;
  fdv?: number | string | null;
  priceUsd?: number | string | null;
  pairCreatedAt?: number | null;
  url?: string;
  info?: { websites?: Array<{ url?: string }>; socials?: Array<{ type?: string; url?: string }> };
};

const n = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export async function enrichArcMarket(token: ArcTokenEnrichment): Promise<ArcMarketEnrichment> {
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(token.assetId)}`;
    const payload = (await governedDexScreenerJson<any>({
      url,
      caller: 'arc_live_market',
      endpoint: 'ARC_TOKEN_PAIRS',
      priority: 'NORMAL',
      cacheKey: `arc:${token.assetId.toLowerCase()}`,
      cacheTtlMs: 10_000,
      signal: AbortSignal.timeout(8_000),
    })).value;
    const pairs: Pair[] = Array.isArray(payload?.pairs) ? payload.pairs : [];
    const asset = token.assetId.toLowerCase();
    const quote = token.quoteAsset.toLowerCase();
    const normalizedQuote = quote === '0x0000000000000000000000000000000000000000'
      ? ARC_USDC_ADDRESS.toLowerCase()
      : quote;
    if (pairs.length > 0) {
      console.log('[ArcMarket] provider pairs returned', {
        assetId: token.assetId,
        candidates: pairs.slice(0, 8).map(pair => ({
          chainId: pair.chainId ?? null,
          pairAddress: pair.pairAddress ?? null,
          base: pair.baseToken?.address ?? null,
          quote: pair.quoteToken?.address ?? null,
          liquidityUsd: n(pair.liquidity?.usd),
        })),
      });
    }
    const matching = pairs.filter(pair => {
      const chain = String(pair.chainId ?? '').toLowerCase();
      const base = String(pair.baseToken?.address ?? '').toLowerCase();
      const q = String(pair.quoteToken?.address ?? '').toLowerCase();
      return chain.includes('arc') && ((base === asset && q === normalizedQuote) || (base === normalizedQuote && q === asset));
    });
    const best = matching.sort((a, b) => (n(b.liquidity?.usd) ?? 0) - (n(a.liquidity?.usd) ?? 0))[0];
    if (!best) throw new Error('No verified Arc pair returned by market provider');
    return {
      ...token,
      marketDataSource: 'DEXSCREENER',
      liquidityUsd: n(best.liquidity?.usd),
      volume5mUsd: n(best.volume?.m5),
      buys5m: n(best.txns?.m5?.buys),
      sells5m: n(best.txns?.m5?.sells),
      marketCapUsd: n(best.marketCap) ?? n(best.fdv),
      priceUsd: n(best.priceUsd),
      pairCreatedAt: n(best.pairCreatedAt),
      dexUrl: typeof best.url === 'string' && best.url.startsWith('http') ? best.url : `https://dexscreener.com/arc/${token.assetId}`,
      projectWebsite: best.info?.websites?.find(item => typeof item?.url === 'string' && item.url.startsWith('http'))?.url ?? null,
      projectTwitter: best.info?.socials?.find(item => /twitter|x/i.test(String(item?.type ?? '')) && typeof item?.url === 'string' && item.url.startsWith('http'))?.url ?? null,
      projectTelegram: best.info?.socials?.find(item => /telegram/i.test(String(item?.type ?? '')) && typeof item?.url === 'string' && item.url.startsWith('http'))?.url ?? null,
    };
  } catch (error) {
    console.warn('[ArcMarket] market enrichment unavailable; candidate remains non-alertable', {
      assetId: token.assetId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return { ...token, marketDataSource: null, liquidityUsd: null, volume5mUsd: null, buys5m: null, sells5m: null, marketCapUsd: null, priceUsd: null, pairCreatedAt: null, dexUrl: null, projectWebsite: null, projectTwitter: null, projectTelegram: null };
  }
}
