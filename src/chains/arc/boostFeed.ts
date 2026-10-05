import { governedDexScreenerJson } from '../../services/dexscreenerRequestGovernor.js';

export async function fetchArcBoostFeed() {
  const { value } = await governedDexScreenerJson<unknown>({
    url: 'https://api.dexscreener.com/token-boosts/latest/v1',
    caller: 'arc_boost_feed', endpoint: 'BOOSTS', priority: 'NORMAL',
    cacheTtlMs: 15_000, queueWaitTimeoutMs: 1_000, httpTimeoutMs: 4_000,
  });
  if (!Array.isArray(value)) throw new Error('Malformed Boost feed: expected array');
  return value.filter(item => item?.chainId === 'arc' && /^0x[a-fA-F0-9]{40}$/.test(String(item.tokenAddress))
    && Number.isFinite(Number(item.amount)) && Number(item.amount) >= 0
    && Number.isFinite(Number(item.totalAmount)) && Number(item.totalAmount) >= 0)
    .map(item => ({ tokenAddress: String(item.tokenAddress), amount: Number(item.amount), totalAmount: Number(item.totalAmount) }));
}

// Reject contradictory provider windows rather than inventing a corrected volume.
export function consistentArcVolume5m(short: unknown, daily: unknown): number | null {
  if (short == null || short === '') return null;
  const value = Number(short);
  if (!Number.isFinite(value) || value < 0) return null;
  if (daily != null && daily !== '' && Number.isFinite(Number(daily)) && value > Number(daily)) return null;
  return value;
}
