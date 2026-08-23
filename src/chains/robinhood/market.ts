import type {
  ChainMarketSnapshot,
} from '../shared/types.js';

const DEXSCREENER_CHAIN_ID = 'robinhood';

type DexScreenerToken = {
  address?: string;
  name?: string;
  symbol?: string;
};

export type DexScreenerPair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;

  baseToken?: DexScreenerToken;
  quoteToken?: DexScreenerToken;

  priceUsd?: string | null;

  txns?: {
    m5?: {
      buys?: number;
      sells?: number;
    };
  };

  volume?: {
    m5?: number;
  };

  liquidity?: {
    usd?: number;
  };

  marketCap?: number | null;
  fdv?: number | null;

  pairCreatedAt?: number | null;
};

export type QuoteUsdObservation = {
  state: 'VERIFIED' | 'UNAVAILABLE';
  quoteAddress: string;
  usdPrice: number | null;
  source: string | null;
  observedAt: string;
};

const QUOTE_USD_CACHE_MS = 60_000;
const quoteUsdCache = new Map<string, { expiresAt: number; observation: QuoteUsdObservation }>();

function finiteNumber(
  value: unknown,
): number {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

export function chooseBestRobinhoodPair(
  pairs: DexScreenerPair[],
  tokenAddress: string,
): DexScreenerPair | null {
  const matching = pairs.filter(pair =>
    pair.baseToken?.address?.toLowerCase() === tokenAddress.toLowerCase());
  if (!matching.length) {
    return null;
  }

  /*
   * Prefer the pair with the most USD liquidity.
   *
   * This is intentionally simple for the first version.
   * Later AlphaOS can also consider volume, age and DEX quality.
   */
  return [...matching].sort(
    (a, b) =>
      finiteNumber(b.liquidity?.usd) -
      finiteNumber(a.liquidity?.usd),
  )[0] ?? null;
}

export async function fetchRobinhoodPairs(
  tokenAddress: string,
): Promise<DexScreenerPair[]> {
  const address =
    tokenAddress.trim();

  if (!address) {
    return [];
  }

  const url =
    'https://api.dexscreener.com/' +
    `token-pairs/v1/${DEXSCREENER_CHAIN_ID}/` +
    encodeURIComponent(address);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text =
      await response
        .text()
        .catch(() => '');

    throw new Error(
      `Robinhood DexScreener request failed: ` +
      `${response.status} ${text}`,
    );
  }

  const data =
    (await response.json()) as unknown;

  if (!Array.isArray(data)) {
    return [];
  }

  return data.filter(
    (pair): pair is DexScreenerPair =>
      Boolean(
        pair &&
        typeof pair === 'object' &&
        (pair as DexScreenerPair)
          .chainId ===
          DEXSCREENER_CHAIN_ID,
      ),
  );
}

export function selectVerifiedQuoteUsdObservation(args: {
  quoteAddress: string;
  pairs: DexScreenerPair[];
  observedAt?: Date;
}): QuoteUsdObservation {
  const quoteAddress = args.quoteAddress.toLowerCase();
  const matching = args.pairs.filter((pair) =>
    pair.chainId === DEXSCREENER_CHAIN_ID &&
    pair.baseToken?.address?.toLowerCase() === quoteAddress &&
    finiteNumber(pair.priceUsd) > 0,
  );
  const pair = chooseBestRobinhoodPair(matching, args.quoteAddress);
  const observedAt = (args.observedAt ?? new Date()).toISOString();
  if (!pair) {
    return { state: 'UNAVAILABLE', quoteAddress: args.quoteAddress, usdPrice: null, source: null, observedAt };
  }
  return {
    state: 'VERIFIED',
    quoteAddress: pair.baseToken!.address!,
    usdPrice: finiteNumber(pair.priceUsd),
    source: 'DEXSCREENER_ROBINHOOD_BASE_TOKEN_PRICE',
    observedAt,
  };
}

export function isFreshQuoteUsdObservation(
  observation: QuoteUsdObservation,
  now = Date.now(),
  maxAgeMs = 2 * 60 * 1000,
): boolean {
  const observedAt = new Date(observation.observedAt).getTime();
  return observation.state === 'VERIFIED' && observation.usdPrice != null &&
    Number.isFinite(observation.usdPrice) && observation.usdPrice > 0 &&
    Number.isFinite(observedAt) && now - observedAt >= 0 && now - observedAt <= maxAgeMs;
}

export async function getVerifiedRobinhoodQuoteUsd(
  quoteAddress: string,
): Promise<QuoteUsdObservation> {
  const key = quoteAddress.toLowerCase();
  const cached = quoteUsdCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.observation;
  const observation = selectVerifiedQuoteUsdObservation({
    quoteAddress,
    pairs: await fetchRobinhoodPairs(quoteAddress),
  });
  quoteUsdCache.set(key, { expiresAt: Date.now() + QUOTE_USD_CACHE_MS, observation });
  return observation;
}

export async function getRobinhoodMarketSnapshot(
  tokenAddress: string,
): Promise<ChainMarketSnapshot | null> {
  const pairs =
    await fetchRobinhoodPairs(
      tokenAddress,
    );

  const pair =
    chooseBestRobinhoodPair(pairs, tokenAddress);

  if (!pair) {
    return null;
  }

  const priceUsd =
    finiteNumber(pair.priceUsd);

  if (priceUsd <= 0) {
    return null;
  }

  const marketCapUsd = finiteNumber(pair.marketCap);
  const fdvUsd = finiteNumber(pair.fdv);

  const liquidityUsd =
    finiteNumber(
      pair.liquidity?.usd,
    );

  const volume5mUsd =
    finiteNumber(
      pair.volume?.m5,
    );

  const buys5m =
    finiteNumber(
      pair.txns?.m5?.buys,
    );

  const sells5m =
    finiteNumber(
      pair.txns?.m5?.sells,
    );

  return {
    chain: 'robinhood',

    tokenAddress,

    symbol:
      pair.baseToken?.symbol ??
      'UNKNOWN',

    name:
      pair.baseToken?.name ??
      pair.baseToken?.symbol ??
      'Unknown Token',

    priceUsd,

    marketCapUsd,
    fdvUsd,
    liquidityUsd,

    volume5mUsd,

    buys5m,
    sells5m,

    pairAddress:
      pair.pairAddress,

    dexId:
      pair.dexId,

    chartUrl:
      pair.url ??
      `https://dexscreener.com/robinhood/${pair.pairAddress ?? ''}`,

    timestamp:
      Date.now(),
  };
}
