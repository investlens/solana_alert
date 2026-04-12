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

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'momentum-risk-bot/4.0',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} for ${url} :: ${body.slice(0, 250)}`);
  }

  return (await res.json()) as T;
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
  const result = scoreToken({ pair, profile, paidApproved, boostAmount, hasTakeover });

  return { pair, result };
}