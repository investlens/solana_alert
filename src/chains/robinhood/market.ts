import type {
  ChainMarketSnapshot,
} from '../shared/types.js';

const DEXSCREENER_CHAIN_ID = 'robinhood';

type DexScreenerToken = {
  address?: string;
  name?: string;
  symbol?: string;
};

type DexScreenerPair = {
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

function finiteNumber(
  value: unknown,
): number {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function chooseBestRobinhoodPair(
  pairs: DexScreenerPair[],
): DexScreenerPair | null {
  if (!pairs.length) {
    return null;
  }

  /*
   * Prefer the pair with the most USD liquidity.
   *
   * This is intentionally simple for the first version.
   * Later AlphaOS can also consider volume, age and DEX quality.
   */
  return [...pairs].sort(
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

  const response =
    await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });

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

export async function getRobinhoodMarketSnapshot(
  tokenAddress: string,
): Promise<ChainMarketSnapshot | null> {
  const pairs =
    await fetchRobinhoodPairs(
      tokenAddress,
    );

  const pair =
    chooseBestRobinhoodPair(pairs);

  if (!pair) {
    return null;
  }

  const priceUsd =
    finiteNumber(pair.priceUsd);

  if (priceUsd <= 0) {
    return null;
  }

  const marketCapUsd =
    finiteNumber(
      pair.marketCap ??
      pair.fdv,
    );

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
