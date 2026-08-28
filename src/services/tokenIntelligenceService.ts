import { getAddress } from 'viem';
import { config } from '../config.js';
import { fetchRobinhoodPairs, chooseBestRobinhoodPair, robinhoodMarketSnapshotFromPairs } from '../chains/robinhood/market.js';
import { robinhoodChain } from '../chains/robinhood/config.js';
import { getRobinhoodTokenMetadata, type RobinhoodTokenMetadata } from '../chains/robinhood/tokenMetadata.js';
import { scanRobinhoodHolderRisk } from '../chains/robinhood/security/holderRiskScanner.js';
import { supabase } from './supabase.js';

const CACHE_MS = 15 * 60_000, ANALYSIS_DEADLINE_MS = 8_000, CUTOFF_CACHE_MS = 60_000;
const BLOCKSCOUT_BASE = 'https://robinhoodchain.blockscout.com';
const inFlight = new Map<string, Promise<TokenIntel>>();
let cutoffCache: { block: bigint; expiresAt: number } | null = null;

export type WalletFreshness = 'VERIFIED_FRESH' | 'NOT_FRESH' | 'UNKNOWN';
export type FreshConfidence = 'VERIFIED' | 'INSUFFICIENT' | 'UNKNOWN';
export type SafeSocial = { label: 'X' | 'Telegram' | 'Website'; url: string };
export type TokenAth = { priceUsd: number | null; priceObservedAt: string | null; priceSource: string | null;
  marketCapUsd: number | null; marketCapObservedAt: string | null; marketCapSource: string | null;
  distanceFromPricePct: number | null; distanceFromMarketCapPct: number | null };
export type FreshWalletIntel = { oneDayPct: number | null; verifiedFresh: number; notFresh: number; unknown: number;
  classified: number; coveragePct: number | null; sampleSize: number; evidence: FreshConfidence; methodology: string };
export type TokenIntel = {
  status: 'COMPLETE' | 'PARTIAL'; analyzedAt: string; chain: 'robinhood'; tokenAddress: string;
  name: string | null; symbol: string | null; decimals: number | null; supply: string | null;
  ageObservedAt: string | null; price: number | null; marketCap: number | null; liquidity: number | null;
  volume5m: number | null; chartUrl: string | null; ath: TokenAth;
  holders: { count: number | null; top10Pct: number | null; largestPct: number | null; risk: string; warnings: string[] };
  freshWallets: FreshWalletIntel;
  developer: { wallet: string | null; holdingPct: number | null; sold: boolean | null; transferredPct: number | null; burnedPct: number | null };
  devHistory: { launches: number; measuredSuccessful: number; weakOrFailed: number; verdict: string; risks: string[] };
  security: { tokenBurnedPct: number | null; lpStatus: 'LOCKED' | 'BURNED' | 'UNLOCKED' | 'UNKNOWN'; dexPaid: boolean | null; boostTotal: number | null };
  socials: SafeSocial[]; alpha: { state: string | null; risk: string | null; verdict: string; positive: string[]; watch: string[] };
  incompleteReason?: string | null;
};

const unknownAth = (): TokenAth => ({ priceUsd: null, priceObservedAt: null, priceSource: null, marketCapUsd: null,
  marketCapObservedAt: null, marketCapSource: null, distanceFromPricePct: null, distanceFromMarketCapPct: null });
const methodology = 'Verified by EVM transaction nonce at the block nearest the 24-hour cutoff; AlphaOS first-seen time is not wallet age.';
const unknownFresh = (sampleSize = 0, evidence: FreshConfidence = 'UNKNOWN'): FreshWalletIntel => ({ oneDayPct: null,
  verifiedFresh: 0, notFresh: 0, unknown: sampleSize, classified: 0, coveragePct: sampleSize ? 0 : null,
  sampleSize, evidence, methodology });
const positive = (value: unknown): number | null => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; };
function bounded<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('analysis deadline exceeded'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('analysis deadline exceeded'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function validateProjectSocial(rawUrl: unknown, kind?: string): SafeSocial | null {
  if (typeof rawUrl !== 'string') return null;
  try {
    const url = new URL(rawUrl.trim()); if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'x.com' || host === 'twitter.com') return { label: 'X', url: url.toString() };
    if (host === 't.me' || host === 'telegram.me') return { label: 'Telegram', url: url.toString() };
    if (kind === 'website' && host !== 'localhost' && !host.endsWith('.local')) return { label: 'Website', url: url.toString() };
  } catch { /* invalid */ }
  return null;
}

export function freshWalletRiskBlocksPositive(raw: Record<string, unknown> | null, threshold = config.maxFreshWallet1dPct) {
  const pct = Number(raw?.freshWallet1dPct);
  return raw?.freshWalletEvidence === 'VERIFIED' && Number.isFinite(pct) && pct > threshold;
}

export function freshWalletEvidenceFromStates(states: WalletFreshness[]): FreshWalletIntel {
  if (!states.length) return unknownFresh();
  const verifiedFresh = states.filter(x => x === 'VERIFIED_FRESH').length;
  const notFresh = states.filter(x => x === 'NOT_FRESH').length;
  const unknown = states.filter(x => x === 'UNKNOWN').length;
  const classified = verifiedFresh + notFresh, coveragePct = classified / states.length * 100;
  const sufficient = states.length >= config.freshWalletMinSample && classified >= 5 && coveragePct >= config.freshWalletMinClassifiedCoveragePct;
  return { oneDayPct: classified ? verifiedFresh / classified * 100 : null, verifiedFresh, notFresh, unknown, classified,
    coveragePct, sampleSize: states.length, evidence: sufficient ? 'VERIFIED' : 'INSUFFICIENT', methodology };
}

async function cutoffBlockOneDayAgo(signal: AbortSignal) {
  if (cutoffCache && cutoffCache.expiresAt > Date.now()) return cutoffCache.block;
  const timestamp = Math.floor(Date.now() / 1000) - 86_400, controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await fetch(`${BLOCKSCOUT_BASE}/api?module=block&action=getblocknobytime&timestamp=${timestamp}&closest=before`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.any([signal, controller.signal]) });
    if (!response.ok) throw new Error(`Blockscout cutoff HTTP ${response.status}`);
    const payload = await response.json() as { result?: string };
    if (!payload.result || !/^\d+$/.test(payload.result)) throw new Error('Blockscout cutoff unavailable');
    const block = BigInt(payload.result); cutoffCache = { block, expiresAt: Date.now() + CUTOFF_CACHE_MS }; return block;
  } finally { clearTimeout(timeout); }
}

async function nonceBatch(wallets: string[], cutoff: bigint, signal: AbortSignal): Promise<WalletFreshness[]> {
  const requests = wallets.flatMap((wallet, index) => [
    { jsonrpc: '2.0', id: index * 2, method: 'eth_getTransactionCount', params: [wallet, `0x${cutoff.toString(16)}`] },
    { jsonrpc: '2.0', id: index * 2 + 1, method: 'eth_getTransactionCount', params: [wallet, 'latest'] },
  ]);
  const response = await fetch(robinhoodChain.rpcUrls.default.http[0], { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requests), signal });
  if (!response.ok) throw new Error(`Nonce batch HTTP ${response.status}`);
  const payload = await response.json() as Array<{ id: number; result?: string; error?: unknown }>;
  const byId = new Map(payload.map(item => [item.id, item]));
  return wallets.map((_wallet, index) => {
    const then = byId.get(index * 2), current = byId.get(index * 2 + 1);
    if (!then?.result || !current?.result || then.error || current.error) return 'UNKNOWN';
    return BigInt(then.result) > 0n ? 'NOT_FRESH' : BigInt(current.result) > 0n ? 'VERIFIED_FRESH' : 'UNKNOWN';
  });
}

export async function analyzeFreshWalletSample(wallets: string[], options: { signal?: AbortSignal } = {}) {
  const sample = [...new Set(wallets.map(x => x.toLowerCase()))].slice(0, 20);
  if (!sample.length) return unknownFresh();
  const signal = options.signal ?? new AbortController().signal;
  let cutoff: bigint; try { cutoff = await cutoffBlockOneDayAgo(signal); } catch { return unknownFresh(sample.length); }
  const states: WalletFreshness[] = [];
  for (let i = 0; i < sample.length && !signal.aborted; i += 5) {
    try { states.push(...await nonceBatch(sample.slice(i, i + 5), cutoff, signal)); }
    catch { states.push(...sample.slice(i, i + 5).map(() => 'UNKNOWN' as const)); }
  }
  while (states.length < sample.length) states.push('UNKNOWN');
  return freshWalletEvidenceFromStates(states);
}

export async function analyzeRobinhoodTokenFreshWallets(tokenAddress: string) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), ANALYSIS_DEADLINE_MS);
  try {
    const metadata = await getRobinhoodTokenMetadata(tokenAddress, { signal: controller.signal });
    const holders = await scanRobinhoodHolderRisk(tokenAddress, { metadata, signal: controller.signal });
    return await analyzeFreshWalletSample(holders.sampledWallets, { signal: controller.signal });
  } finally { clearTimeout(timeout); controller.abort(); }
}

export function freshWalletBlockPersistence(fresh: FreshWalletIntel, analyzedAt: string) {
  return { riskReason: 'HIGH_FRESH_WALLET_CONCENTRATION', evidence: { freshWallet1dPct: fresh.oneDayPct,
    freshWalletEvidence: fresh.evidence, freshWalletSampleSize: fresh.sampleSize,
    freshWalletClassifiedCount: fresh.classified, freshWalletCoveragePct: fresh.coveragePct,
    freshWalletThreshold: config.maxFreshWallet1dPct, freshWalletAnalyzedAt: analyzedAt,
    freshWalletRiskReason: 'HIGH_FRESH_WALLET_CONCENTRATION' } };
}

function socialLinks(pair: ReturnType<typeof chooseBestRobinhoodPair>) {
  if (!pair?.info) return [];
  const values = [...(pair.info.socials ?? []).map(x => validateProjectSocial(x.url, x.type)),
    ...(pair.info.websites ?? []).map(x => validateProjectSocial(x.url, 'website'))].filter((x): x is SafeSocial => Boolean(x));
  return [...new Map(values.map(x => [x.label, x])).values()];
}

function maxObservation(...values: Array<{ value: number | null; at: string | null; source: string | null }>) {
  return values.filter(x => x.value != null && x.source).sort((a, b) => Number(b.value) - Number(a.value))[0]
    ?? { value: null, at: null, source: null };
}

export function mergeTokenAth(args: { previous?: TokenAth | null; historicalPrice?: any; historicalMc?: any;
  currentPrice?: number | null; currentMc?: number | null; observedAt: string; currentVerified: boolean }): TokenAth {
  const prior = args.previous ?? unknownAth();
  const price = maxObservation({ value: prior.priceUsd, at: prior.priceObservedAt, source: prior.priceSource },
    { value: positive(args.historicalPrice?.price), at: args.historicalPrice?.alerted_at ?? null, source: args.historicalPrice?.price_provenance ?? null },
    { value: args.currentVerified ? positive(args.currentPrice) : null, at: args.observedAt, source: 'DEXSCREENER_VERIFIED_BASE_PAIR' });
  const mc = maxObservation({ value: prior.marketCapUsd, at: prior.marketCapObservedAt, source: prior.marketCapSource },
    { value: positive(args.historicalMc?.market_cap), at: args.historicalMc?.alerted_at ?? null, source: args.historicalMc?.valuation_provenance ?? null },
    { value: args.currentVerified ? positive(args.currentMc) : null, at: args.observedAt, source: 'DEXSCREENER_VERIFIED_BASE_PAIR' });
  return { priceUsd: price.value, priceObservedAt: price.at, priceSource: price.source,
    marketCapUsd: mc.value, marketCapObservedAt: mc.at, marketCapSource: mc.source,
    distanceFromPricePct: price.value && args.currentVerified && positive(args.currentPrice) ? (args.currentPrice! - price.value) / price.value * 100 : null,
    distanceFromMarketCapPct: mc.value && args.currentVerified && positive(args.currentMc) ? (args.currentMc! - mc.value) / mc.value * 100 : null };
}

async function databaseContext(token: string, signal: AbortSignal) {
  const base = () => supabase.from('alpha_alert_events');
  const queries = [
    base().select('semantic_event_type,intelligence_state,risk_label,boost_total,raw_snapshot').eq('chain', 'robinhood').ilike('asset_id', token).order('alerted_at', { ascending: false }).limit(1).maybeSingle(),
    base().select('price,price_provenance,alerted_at').eq('chain', 'robinhood').ilike('asset_id', token).not('price_provenance', 'is', null).gt('price', 0).order('price', { ascending: false }).limit(1).maybeSingle(),
    base().select('market_cap,valuation_provenance,alerted_at').eq('chain', 'robinhood').ilike('asset_id', token).not('valuation_provenance', 'is', null).gt('market_cap', 0).order('market_cap', { ascending: false }).limit(1).maybeSingle(),
    base().select('boost_total').eq('chain', 'robinhood').ilike('asset_id', token).gt('boost_total', 0).order('boost_total', { ascending: false }).limit(1).maybeSingle(),
    base().select('id').eq('chain', 'robinhood').ilike('asset_id', token).eq('semantic_event_type', 'DEX_PAID').limit(1).maybeSingle(),
    supabase.from('creator_launches').select('creator_wallet').eq('chain', 'robinhood').ilike('token', token)
      .not('creator_wallet', 'is', null).order('launched_at', { ascending: false }).limit(1).maybeSingle(),
  ];
  const [latest, price, mc, boost, dex, creator] = await bounded(Promise.all(queries), signal);
  for (const item of [latest, price, mc, boost, dex, creator]) if (item.error) throw item.error;
  const creatorWallet = (creator.data as any)?.creator_wallet;
  const history = creatorWallet ? await bounded(supabase.from('creator_launches')
    .select('creator_wallet,peak_market_cap,crossed_50k,severe_crash,catastrophic_crash,launched_at')
    .eq('chain', 'robinhood').ilike('creator_wallet', creatorWallet).order('launched_at', { ascending: false })
    .limit(100), signal) : { data: [], error: null };
  if (history.error) throw history.error;
  return { latest: latest.data as any, historicalPrice: price.data, historicalMc: mc.data,
    boostTotal: positive((boost.data as any)?.boost_total), dexPaid: dex.data ? true : null,
    creatorRows: (history.data ?? []) as any[] };
}

function emptyIntel(token: string, previous?: TokenIntel | null): TokenIntel {
  return { status: 'PARTIAL', analyzedAt: new Date().toISOString(), chain: 'robinhood', tokenAddress: token,
    name: previous?.name ?? null, symbol: previous?.symbol ?? null, decimals: previous?.decimals ?? null, supply: previous?.supply ?? null,
    ageObservedAt: previous?.ageObservedAt ?? null, price: null, marketCap: null, liquidity: null, volume5m: null,
    chartUrl: previous?.chartUrl ?? null, ath: previous?.ath ?? unknownAth(),
    holders: { count: null, top10Pct: null, largestPct: null, risk: 'UNKNOWN', warnings: [] }, freshWallets: unknownFresh(),
    developer: { wallet: null, holdingPct: null, sold: null, transferredPct: null, burnedPct: null },
    devHistory: { launches: 0, measuredSuccessful: 0, weakOrFailed: 0, verdict: 'Creator history unavailable.', risks: [] },
    security: { tokenBurnedPct: null, lpStatus: 'UNKNOWN', dexPaid: null, boostTotal: null }, socials: [],
    alpha: { state: null, risk: null, verdict: 'Showing verified data collected within the analysis budget.', positive: [], watch: [] },
    incompleteReason: 'Some intelligence is still unavailable. Showing verified data collected within analysis budget.' };
}

export async function analyzeRobinhoodToken(tokenAddress: string, previous?: TokenIntel | null,
  budgetMs = ANALYSIS_DEADLINE_MS): Promise<TokenIntel> {
  const token = getAddress(tokenAddress), result = emptyIntel(token, previous), controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(100, budgetMs));
  try {
    const observedAt = new Date().toISOString();
    const [metadataResult, pairsResult] = await Promise.allSettled([
      getRobinhoodTokenMetadata(token, { signal: controller.signal }), fetchRobinhoodPairs(token, { signal: controller.signal })]);
    const metadata: RobinhoodTokenMetadata | null = metadataResult.status === 'fulfilled' ? metadataResult.value : null;
    const pairs = pairsResult.status === 'fulfilled' ? pairsResult.value : [], market = robinhoodMarketSnapshotFromPairs(token, pairs);
    const pair = chooseBestRobinhoodPair(pairs, token);
    if (metadata) Object.assign(result, { name: metadata.name ?? market?.name ?? null, symbol: metadata.symbol ?? market?.symbol ?? null,
      decimals: metadata.decimals, supply: metadata.totalSupplyRaw?.toString() ?? null });
    if (market) Object.assign(result, { price: market.priceUsd, marketCap: market.marketCapUsd, liquidity: market.liquidityUsd,
      volume5m: market.volume5mUsd, chartUrl: market.chartUrl ?? null });
    result.ageObservedAt = pair?.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : null; result.socials = socialLinks(pair);
    const [holderResult, dbResult] = await Promise.allSettled([
      metadata ? scanRobinhoodHolderRisk(token, { metadata, signal: controller.signal }) : Promise.reject(new Error('metadata unavailable')),
      databaseContext(token, controller.signal)]);
    const db = dbResult.status === 'fulfilled' ? dbResult.value : null;
    result.ath = mergeTokenAth({ previous: previous?.ath, historicalPrice: db?.historicalPrice, historicalMc: db?.historicalMc,
      currentPrice: market?.priceUsd, currentMc: market?.marketCapUsd, observedAt, currentVerified: Boolean(market) });
    if (db) {
      result.security.dexPaid = db.dexPaid; result.security.boostTotal = db.boostTotal;
      result.alpha.state = db.latest?.intelligence_state ?? null; result.alpha.risk = db.latest?.risk_label ?? null;
      const raw = (db.latest?.raw_snapshot ?? {}) as Record<string, unknown>;
      result.developer = { wallet: typeof raw.deployerAddress === 'string' ? raw.deployerAddress : null,
        holdingPct: positive(raw.devHoldingPercent), sold: raw.confirmedDevSell === true ? true : raw.confirmedDevSell === false ? false : null,
        transferredPct: positive(raw.otherDevTransferPercent), burnedPct: positive(raw.confirmedDevBurnPercent) };
      result.security.tokenBurnedPct = positive(raw.totalBurnPercent);
    }
    if (holderResult.status === 'fulfilled') {
      const holders = holderResult.value;
      result.holders = { count: holders.holderCountObserved || null, top10Pct: holders.top10Pct, largestPct: holders.top1Pct,
        risk: holders.concentrationRisk, warnings: holders.warnings };
      result.freshWallets = await analyzeFreshWalletSample(holders.sampledWallets, { signal: controller.signal });
    }
    if (db) {
      const launches = db.creatorRows.length;
      const successes = db.creatorRows.filter(row => row.crossed_50k === true && positive(row.peak_market_cap)).length;
      const failures = db.creatorRows.filter(row => row.severe_crash === true || row.catastrophic_crash === true).length;
      result.devHistory = { launches, measuredSuccessful: successes, weakOrFailed: failures,
        verdict: launches ? 'Measured creator history from verified observed launches.' : 'Creator history unavailable.',
        risks: launches > 3 ? ['More than 3 verified launches is negative history evidence, not a scam label.'] : [] };
      if (!result.developer.wallet && typeof db.creatorRows[0]?.creator_wallet === 'string') result.developer.wallet = db.creatorRows[0].creator_wallet;
      result.alpha.watch = [...result.holders.warnings, ...result.devHistory.risks].slice(0, 4);
    }
    if (freshWalletRiskBlocksPositive({ freshWallet1dPct: result.freshWallets.oneDayPct, freshWalletEvidence: result.freshWallets.evidence }))
      result.alpha.watch.unshift(`High fresh-wallet concentration (${result.freshWallets.oneDayPct!.toFixed(1)}% of classified wallets)`);
    const complete = !controller.signal.aborted && metadata != null && market != null && holderResult.status === 'fulfilled' && db != null && result.freshWallets.evidence === 'VERIFIED';
    result.status = complete ? 'COMPLETE' : 'PARTIAL'; result.incompleteReason = complete ? null : result.incompleteReason;
    result.analyzedAt = new Date().toISOString(); return result;
  } catch { return result; } finally { clearTimeout(timeout); controller.abort(); }
}

export async function getRobinhoodTokenIntelligence(tokenAddress: string): Promise<TokenIntel> {
  const startedAt = Date.now(), token = getAddress(tokenAddress), key = `robinhood:${token.toLowerCase()}`, now = new Date().toISOString();
  const cacheController = new AbortController(); const cacheTimeout = setTimeout(() => cacheController.abort(), 1_500);
  const cacheResult = await bounded(supabase.from('token_intelligence_cache').select('status,result,expires_at')
    .eq('chain', 'robinhood').ilike('token_address', token).maybeSingle(), cacheController.signal)
    .catch(() => ({ data: null, error: null }));
  clearTimeout(cacheTimeout);
  const data = cacheResult.data as { status: string; result: unknown; expires_at: string } | null;
  if (data && data.expires_at > now && (data.status === 'COMPLETE' || data.status === 'PARTIAL')) return data.result as TokenIntel;
  const running = inFlight.get(key); if (running) return running;
  const request = analyzeRobinhoodToken(token, (data?.result as TokenIntel | undefined) ?? null,
    ANALYSIS_DEADLINE_MS - (Date.now() - startedAt)).then(async result => {
    const { error } = await supabase.from('token_intelligence_cache').upsert({ chain: 'robinhood', token_address: token.toLowerCase(),
      status: result.status, result, analyzed_at: result.analyzedAt, expires_at: new Date(Date.now() + CACHE_MS).toISOString() },
      { onConflict: 'chain,token_address' });
    if (error) console.warn('[TokenIntel] Cache write failed', { token, error: error.message }); return result;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, request); return request;
}
