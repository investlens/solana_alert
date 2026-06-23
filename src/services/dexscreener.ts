import { config } from '../config.js';
import type {
  BoostToken,
  DexOrder,
  DexPair,
  DexProfile,
  EnrichedToken,
  TakeoverToken,
} from '../types.js';
import { scoreToken } from '../core/scoring.js';

const jsonCache = new Map<string, { expiresAt: number; data: unknown }>();
const backoffUntil = new Map<string, number>();

function cacheMsForUrl(url: string) {
  if (url.includes('/token-profiles/latest')) return 60_000;
  if (url.includes('/token-boosts/latest')) return 90_000;
  if (url.includes('/community-takeovers/latest')) return 90_000;
  if (url.includes('/token-pairs/')) return 45_000;
  if (url.includes('/orders/')) return 120_000;
  return 60_000;
}

async function getJson<T>(url: string): Promise<T> {
  const now = Date.now();

  const cached = jsonCache.get(url);
  if (cached && cached.expiresAt > now) {
    return cached.data as T;
  }

  const blockedUntil = backoffUntil.get(url) ?? 0;
  if (blockedUntil > now) {
    if (cached) return cached.data as T;
    throw new Error(`DexScreener backoff active for ${url}`);
  }

  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'alphaos-agent/1.0',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');

    if (res.status === 429) {
      const waitMs = 5 * 60 * 1000;
      backoffUntil.set(url, now + waitMs);

      console.log('DexScreener 429 backoff:', {
        url,
        waitSec: waitMs / 1000,
      });

      if (cached) {
        return cached.data as T;
      }
    }

    throw new Error(`HTTP ${res.status} for ${url} :: ${body.slice(0, 250)}`);
  }

  const data = (await res.json()) as T;

  jsonCache.set(url, {
    expiresAt: now + cacheMsForUrl(url),
    data,
  });

  return data;
}

export async function fetchLatestProfiles(): Promise<DexProfile[]> {
  const rows = await getJson<DexProfile[]>('https://api.dexscreener.com/token-profiles/latest/v1');

  const chainCounts = new Map<string, number>();
  for (const row of rows) {
    const chain = row.chainId ?? 'unknown';
    chainCounts.set(chain, (chainCounts.get(chain) ?? 0) + 1);
  }
  console.log('Latest profile chain counts:', Object.fromEntries(chainCounts));

  return rows.filter((x) => x.chainId === config.discoveryChain && !!x.tokenAddress);
}

export async function fetchFallbackProfiles(): Promise<DexProfile[]> {
  const [boostRows, takeoverRows] = await Promise.all([
    getJson<BoostToken[]>('https://api.dexscreener.com/token-boosts/latest/v1'),
    getJson<TakeoverToken[]>('https://api.dexscreener.com/community-takeovers/latest/v1'),
  ]);

  const byToken = new Map<string, DexProfile>();

  for (const row of boostRows) {
    if (row.chainId !== config.discoveryChain || !row.tokenAddress) continue;
    byToken.set(row.tokenAddress, { chainId: row.chainId, tokenAddress: row.tokenAddress });
  }

  for (const row of takeoverRows) {
    if (row.chainId !== config.discoveryChain || !row.tokenAddress) continue;
    if (!byToken.has(row.tokenAddress)) {
      byToken.set(row.tokenAddress, { chainId: row.chainId, tokenAddress: row.tokenAddress });
    }
  }

  return [...byToken.values()];
}

export async function fetchBoostMap(): Promise<Map<string, number>> {
  const rows = await getJson<BoostToken[]>('https://api.dexscreener.com/token-boosts/latest/v1');

  const chainCounts = new Map<string, number>();
  for (const row of rows) {
    const chain = row.chainId ?? 'unknown';
    chainCounts.set(chain, (chainCounts.get(chain) ?? 0) + 1);
  }
  console.log('Latest boost chain counts:', Object.fromEntries(chainCounts));

  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.chainId !== config.discoveryChain || !row.tokenAddress) continue;
    map.set(row.tokenAddress, Number(row.totalAmount ?? row.amount ?? 0));
  }
  return map;
}

export async function fetchTakeoverSet(): Promise<Set<string>> {
  const rows = await getJson<TakeoverToken[]>('https://api.dexscreener.com/community-takeovers/latest/v1');

  const chainCounts = new Map<string, number>();
  for (const row of rows) {
    const chain = row.chainId ?? 'unknown';
    chainCounts.set(chain, (chainCounts.get(chain) ?? 0) + 1);
  }
  console.log('Latest takeover chain counts:', Object.fromEntries(chainCounts));

  const set = new Set<string>();
  for (const row of rows) {
    if (row.chainId === config.discoveryChain && row.tokenAddress) set.add(row.tokenAddress);
  }
  return set;
}

export async function fetchPairs(tokenAddress: string): Promise<DexPair[]> {
  return getJson<DexPair[]>(
    `https://api.dexscreener.com/token-pairs/v1/${config.discoveryChain}/${tokenAddress}`
  );
}

export async function fetchOrders(tokenAddress: string): Promise<DexOrder[]> {
  try {
    const data = await getJson<unknown>(
      `https://api.dexscreener.com/orders/v1/${config.discoveryChain}/${tokenAddress}`
    );

    if (Array.isArray(data)) return data as DexOrder[];

    if (
      data &&
      typeof data === 'object' &&
      'orders' in data &&
      Array.isArray((data as { orders?: unknown }).orders)
    ) {
      return (data as { orders: DexOrder[] }).orders;
    }

    console.log('Orders response was not usable:', { tokenAddress, responseType: typeof data, data });
    return [];
  } catch (error) {
    console.log('fetchOrders failed, defaulting to empty orders:', tokenAddress, error);
    return [];
  }
}

export function chooseBestPair(pairs: DexPair[]): DexPair | null {
  if (!pairs.length) return null;

  const filtered = pairs.filter((pair) => Number(pair.liquidity?.usd ?? 0) > 0);
  if (!filtered.length) return null;

  return [...filtered].sort((a, b) => {
    const liqDiff = Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0);
    if (liqDiff !== 0) return liqDiff;
    return Number(b.pairCreatedAt ?? 0) - Number(a.pairCreatedAt ?? 0);
  })[0] ?? null;
}

export async function enrichToken(
  profile: DexProfile,
  boostMap: Map<string, number>,
  takeoverSet: Set<string>
): Promise<EnrichedToken | null> {
  const tokenAddress = profile.tokenAddress;
  if (!tokenAddress) return null;

  const [pairs, orders] = await Promise.all([fetchPairs(tokenAddress), fetchOrders(tokenAddress)]);
  const pair = chooseBestPair(pairs);
  if (!pair) return null;

  const paidApproved = Array.isArray(orders) && orders.some((o) => o.status === 'approved');
  const boostAmount = boostMap.get(tokenAddress) ?? 0;
  const hasTakeover = takeoverSet.has(tokenAddress);
  const result = await scoreToken({ pair, profile, paidApproved, boostAmount, hasTakeover });

  return { pair, result };
}

export async function enrichTokenByMintAddress(mintAddress: string) {
  const profile = {
    chainId: config.discoveryChain,
    tokenAddress: mintAddress,
  };

  const boostMap = await fetchBoostMap();
  const takeoverSet = await fetchTakeoverSet();

  return enrichToken(profile, boostMap, takeoverSet);
}