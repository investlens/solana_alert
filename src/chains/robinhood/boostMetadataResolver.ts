import { getRobinhoodTokenMetadata } from './tokenMetadata.js';
import { supabase } from '../../services/supabase.js';

export type ResolvedBoostMetadata = { name: string | null; symbol: string | null; source: string | null };
const cache = new Map<string, { expiresAt: number; value: ResolvedBoostMetadata }>();

function meaningful(value: unknown): string | null {
  const result = typeof value === 'string' ? value.trim() : '';
  return result && !/^unknown(?: token)?$/i.test(result) ? result : null;
}
export function mergeBoostMetadata(...candidates: Array<Partial<ResolvedBoostMetadata> | null | undefined>): ResolvedBoostMetadata {
  let name: string | null = null, symbol: string | null = null, source: string | null = null;
  for (const candidate of candidates) {
    name ??= meaningful(candidate?.name); symbol ??= meaningful(candidate?.symbol);
    if ((name || symbol) && !source) source = meaningful(candidate?.source);
    if (name && symbol) break;
  }
  return { name, symbol, source };
}

export async function resolveBoostMetadata(tokenAddress: string, seed?: Partial<ResolvedBoostMetadata> | null,
  budgetMs = 650): Promise<ResolvedBoostMetadata> {
  const key = tokenAddress.toLowerCase(); const seeded = mergeBoostMetadata(seed);
  if (seeded.name && seeded.symbol) return seeded;
  const cached = cache.get(key); if (cached && cached.expiresAt > Date.now()) return mergeBoostMetadata(seeded, cached.value);
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), Math.max(50, budgetMs));
  try {
    const lookup = Promise.allSettled([
      supabase.from('token_intelligence_cache').select('result').eq('chain', 'robinhood').ilike('token_address', tokenAddress).maybeSingle(),
      supabase.from('robinhood_observations').select('name,symbol').ilike('token_address', tokenAddress).maybeSingle(),
      supabase.from('alpha_alert_events').select('token_name,symbol').eq('chain', 'robinhood').ilike('asset_id', tokenAddress)
        .order('alerted_at', { ascending: false }).limit(1).maybeSingle(),
      getRobinhoodTokenMetadata(tokenAddress, { signal: controller.signal }),
    ]);
    const queries = await Promise.race([lookup, new Promise<null>(resolve => {
      const timer = setTimeout(() => resolve(null), Math.max(50, budgetMs)); timer.unref?.();
    })]);
    if (!queries) return seeded;
    const intel = queries[0].status === 'fulfilled' ? (queries[0].value.data?.result as any) : null;
    const observation = queries[1].status === 'fulfilled' ? queries[1].value.data : null;
    const event = queries[2].status === 'fulfilled' ? queries[2].value.data : null;
    const onchain = queries[3].status === 'fulfilled' ? queries[3].value : null;
    const value = mergeBoostMetadata(seeded,
      { name: intel?.name, symbol: intel?.symbol, source: 'ALPHAOS_TOKEN_INTELLIGENCE' },
      observation ? { ...observation, source: 'ROBINHOOD_OBSERVATION' } : null,
      event ? { name: event.token_name, symbol: event.symbol, source: 'ALPHA_EVENT_LEDGER' } : null,
      onchain ? { name: onchain.name, symbol: onchain.symbol, source: 'ONCHAIN_ERC20' } : null);
    cache.set(key, { expiresAt: Date.now() + (value.name || value.symbol ? 15 * 60_000 : 30_000), value });
    return value;
  } finally { clearTimeout(timeout); controller.abort(); }
}

export function boostMetadataFallback(tokenAddress: string): ResolvedBoostMetadata {
  const short = tokenAddress.length > 14 ? `${tokenAddress.slice(0, 8)}…${tokenAddress.slice(-6)}` : tokenAddress;
  return { name: null, symbol: short, source: 'SHORTENED_TOKEN_ADDRESS' };
}
