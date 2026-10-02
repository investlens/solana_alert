import { createPublicClient, http, formatUnits, type Address } from 'viem';
import { robinhoodChain } from '../chains/robinhood/config.js';
import { governedDexScreenerJson } from './dexscreenerRequestGovernor.js';
import type { DexScreenerPair } from '../chains/robinhood/market.js';

export type ResearchChain = 'robinhood' | 'arc';
export const researchChains = {
  robinhood: { label: 'Robinchain', id: 4663, native: 'ETH', decimals: 18, explorer: 'https://robinhoodchain.blockscout.com', rpc: robinhoodChain.rpcUrls.default.http[0] },
  arc: { label: 'ARC', id: 5042, native: 'USDC', decimals: 18, explorer: 'https://explorer.arc.io', rpc: process.env.ARC_RPC_URL?.trim() || 'https://rpc.mainnet.arc.io' },
} as const;
export type AccountFacts = { kind: 'wallet' | 'contract' | 'unknown'; balance: bigint | null; nonce: number | null; checkedAt: string };
const accountCache = new Map<string, { expires: number; value: AccountFacts }>();
const pendingAccounts = new Map<string, Promise<AccountFacts>>();
export async function readResearchAccount(address: string, chain: ResearchChain, fresh = false): Promise<AccountFacts> {
  const key = `${chain}:${address}`; const cached = accountCache.get(key);
  if (!fresh && cached && cached.expires > Date.now()) return cached.value;
  if (pendingAccounts.has(key)) return pendingAccounts.get(key)!;
  const work = (async (): Promise<AccountFacts> => {
    const config = researchChains[chain];
    const client = createPublicClient({ transport: http(config.rpc, { timeout: 2_500, retryCount: 0,
      batch: { wait: 10, batchSize: 4 }, fetchOptions: { signal: AbortSignal.timeout(4_000) } }) });
    const results = await Promise.allSettled([client.getChainId(), client.getBytecode({ address: address as Address }),
      client.getBalance({ address: address as Address }), client.getTransactionCount({ address: address as Address })]);
    const verified = results[0].status === 'fulfilled' && results[0].value === config.id;
    const code = results[1]; const balance = results[2]; const nonce = results[3];
    const value: AccountFacts = { kind: verified && code.status === 'fulfilled' ? code.value && code.value !== '0x' ? 'contract' : 'wallet' : 'unknown',
      balance: verified && balance.status === 'fulfilled' ? balance.value : null,
      nonce: verified && nonce.status === 'fulfilled' ? nonce.value : null, checkedAt: new Date().toISOString() };
    if (accountCache.size >= 100) accountCache.delete(accountCache.keys().next().value!);
    accountCache.set(key, { value, expires: Date.now() + 30_000 }); return value;
  })();
  pendingAccounts.set(key, work); try { return await work; } finally { pendingAccounts.delete(key); }
}

export function chooseResearchPair(pairs: DexScreenerPair[], address: string, chain: ResearchChain): DexScreenerPair | null {
  return pairs.filter(p => p && typeof p === 'object' && p.chainId === chain && p.baseToken?.address?.toLowerCase() === address.toLowerCase())
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] ?? null;
}
export async function fetchResearchPairs(address: string): Promise<DexScreenerPair[]> {
  const result = await governedDexScreenerJson<{ pairs?: DexScreenerPair[] }>({
    url: `https://api.dexscreener.com/latest/dex/tokens/${address}`, priority: 'NORMAL', caller: 'address_research',
    endpoint: 'ADDRESS_RESEARCH', cacheKey: `research:${address}`, cacheTtlMs: 15_000,
    queueWaitTimeoutMs: 1_000, httpTimeoutMs: 2_500, signal: AbortSignal.timeout(4_000),
  });
  if (!result.value || !Array.isArray(result.value.pairs)) throw new Error('Market lookup unavailable');
  return result.value.pairs;
}
export function researchCandidates(pairs: DexScreenerPair[], address: string, accounts: Record<ResearchChain, AccountFacts>): ResearchChain[] {
  return (['robinhood', 'arc'] as const).filter(chain => !!chooseResearchPair(pairs, address, chain)
    || accounts[chain].kind === 'contract' || (accounts[chain].balance ?? 0n) > 0n || (accounts[chain].nonce ?? 0) > 0);
}
export type LaunchResearch = { token: string; launchedAt: string | null; peak: number | null; current: number | null; checkedAt: string | null };
export type CreatorHistory = { launches: LaunchResearch[]; available: boolean; capped: boolean };
const positive = (value: unknown): number | null => value != null && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
export async function loadCreatorResearch(address: string, chain: ResearchChain): Promise<CreatorHistory> {
  const { supabase } = await import('./supabase.js');
  const signal = AbortSignal.timeout(2_500);
  const creatorQuery = supabase.from('creator_launches').select('token,launched_at,peak_market_cap,current_market_cap,last_checked_at,tracking_complete')
    .eq('chain', chain).ilike('creator_wallet', address).order('launched_at', { ascending: false }).limit(21).abortSignal(signal);
  const censusQuery = chain === 'robinhood' ? supabase.from('pons_launches').select('token_address,block_timestamp')
    .eq('chain', chain).ilike('deployer_address', address).order('block_timestamp', { ascending: false }).limit(21).abortSignal(signal) : Promise.resolve(null);
  const [creator, census] = await Promise.all([creatorQuery, censusQuery]);
  const rows = new Map<string, LaunchResearch>();
  for (const r of creator.error ? [] : creator.data ?? []) if (/^0x[a-fA-F0-9]{40}$/.test(r.token)) rows.set(r.token.toLowerCase(), {
    token: r.token.toLowerCase(), launchedAt: r.launched_at, peak: r.tracking_complete ? positive(r.peak_market_cap) : null,
    current: positive(r.current_market_cap), checkedAt: r.last_checked_at });
  for (const r of census?.error ? [] : census?.data ?? []) if (/^0x[a-fA-F0-9]{40}$/.test(r.token_address)) {
    const token = r.token_address.toLowerCase(); if (!rows.has(token)) rows.set(token, { token, launchedAt: r.block_timestamp, peak: null, current: null, checkedAt: null });
  }
  const launches = [...rows.values()].sort((a, b) => (b.launchedAt ?? '').localeCompare(a.launchedAt ?? '')).slice(0, 20);
  if (chain === 'robinhood' && launches.length && !signal.aborted) {
    const outcomes = await supabase.from('pons_token_outcomes').select('token_address,peak_market_cap,current_market_cap,last_checked_at,data_confidence,observation_count')
      .eq('chain', chain).in('token_address', launches.map(r => r.token)).limit(40).abortSignal(signal);
    if (!outcomes.error) for (const r of outcomes.data ?? []) {
      const row = rows.get(r.token_address.toLowerCase()); if (!row) continue;
      if (['OBSERVED_HISTORY', 'VERIFIED_HISTORY'].includes(r.data_confidence) && r.observation_count >= 2) row.peak = positive(r.peak_market_cap);
      if (!row.checkedAt || r.last_checked_at > row.checkedAt) { row.current = positive(r.current_market_cap); row.checkedAt = r.last_checked_at; }
    }
  }
  return { launches, available: !creator.error || (census != null && !census.error), capped: rows.size > 20 || (creator.data?.length ?? 0) >= 21 || (census?.data?.length ?? 0) >= 21 };
}
const money = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n.toFixed(2)}`;
export function renderCreatorResearch(address: string, chain: ResearchChain, account: AccountFacts, history: CreatorHistory): string {
  const config = researchChains[chain];
  const lines = ['<b>ALPHAOS · CREATOR INTEL</b>', `${config.label} · Wallet research`, `<code>${address}</code>`, ''];
  if (account.balance != null) lines.push(`Native balance  <b>${formatUnits(account.balance, config.decimals)} ${config.native}</b>`);
  if (account.nonce != null) lines.push(`Transactions sent  <b>${account.nonce}</b>`);
  if (account.kind === 'contract') lines.push('Contract account · May be a smart wallet');
  if (account.kind === 'unknown') lines.push('Live account data unavailable');
  lines.push('', '<b>RECORDED LAUNCHES</b>');
  if (!history.available) lines.push('Launch history unavailable');
  else if (!history.launches.length) lines.push('No launches found in our records');
  else {
    const measured = history.launches.filter(r => r.peak != null);
    lines.push(`${history.capped ? 'Latest' : 'Found'} <b>${history.launches.length}</b> recorded launches · ${measured.length} with observed peaks`);
    for (const row of history.launches.slice(0, 3)) {
      const link = `<a href="${config.explorer}/token/${row.token}">${row.token.slice(0, 6)}…${row.token.slice(-4)}</a>`;
      lines.push(`${link}${row.launchedAt ? ` · ${row.launchedAt.slice(0, 10)}` : ''}`);
      const facts: string[] = [];
      if (row.peak != null) facts.push(`Observed peak ${money(row.peak)}`);
      if (row.current != null) facts.push(`Last MC ${money(row.current)}`);
      if (row.peak != null && row.current != null && row.current <= row.peak) facts.push(`${((1 - row.current / row.peak) * 100).toFixed(1)}% below peak`);
      if (facts.length) lines.push(facts.join(' · '));
      if (row.checkedAt) lines.push(`Outcome checked ${row.checkedAt.slice(0, 16).replace('T', ' ')} UTC`);
    }
  }
  lines.push('', 'Coverage is partial · No records does not mean no prior launches.', 'Sells, transfers and burns not assessed · Research only.', `Account checked ${account.checkedAt.slice(11, 19)} UTC`);
  return lines.join('\n');
}
