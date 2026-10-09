import { removeAlertedCandidate } from './rejectedCandidateReview.js';
import { governedDexScreenerJson } from './dexscreenerRequestGovernor.js';
import {processCompactRunner,type RunnerSample} from './compactRunnerMilestones.js';

export const compactOutcomesEnabled = () => String(process.env.ALPHA_COMPACT_OUTCOMES_ENABLED ?? 'true').toLowerCase() === 'true';
export type CompactAlertBaseline = {
  chain: string; token: string; feed: string; price: number | null | undefined;
  marketCap?: number | null; liquidity?: number | null; pair?: string | null;
  unit?: 'USD' | 'ETH_RESERVE_RATIO'; creator?: string | null;
  creatorSource?: 'PONS_FACTORY_EVENT' | 'CHAIN_DEPLOYMENT_RECEIPT' | null;
};
export type CompactTrackingRow = {
  chain: string; token: string; feed: string; pair_id: string; price_unit: string;
  baseline_price: number; baseline_liquidity?: number | null; samples?: CompactSample[]; started_at: string; checkpoint: number; retried: boolean; lease: string;
};
export type CompactSample = { status: 'MEASURED' | 'UNAVAILABLE'; price: number | null; mc: number | null; liquidity: number | null; at: string; reason?: string; shadow?: 'STRENGTHENING' | 'DETERIORATING' | 'UNCONFIRMED' };
const positive = (value: unknown): number | null => { if (value == null || value === '') return null; const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; };
const seen = new Map<string, number>();
const excluded = new Map<string, { chain: string; feed: string; count: number }>();
let registrations = 0; let minute = 0; let registering = false; let pausedUntil = 0;
let running = false; let maintainedAt = 0;
function exclude(args: CompactAlertBaseline) {
  const key = `${args.chain}:${args.feed}`;
  const old = excluded.get(key);
  if (old) old.count = Math.min(100000, old.count + 1);
  else if (excluded.size < 32) excluded.set(key, { chain: args.chain, feed: args.feed.slice(0, 64), count: 1 });
}

// Best effort after confirmed Telegram acceptance. Never retry or delay alert delivery.
export async function recordCompactAlert(args: CompactAlertBaseline, accepted: number): Promise<void> {
  if (accepted > 0) removeAlertedCandidate(args.chain,args.token);
  if (!compactOutcomesEnabled() || accepted <= 0 || !['solana','robinhood','arc'].includes(args.chain)) return;
  const now = Date.now(); const key = `${args.chain}:${args.chain === 'solana' ? args.token : args.token.toLowerCase()}`;
  for (const [k, expires] of seen) if (expires < now) seen.delete(k);
  if (seen.has(key)) return;
  if (Math.floor(now / 60000) !== minute) { minute = Math.floor(now / 60000); registrations = 0; }
  if (registering || now < pausedUntil || registrations >= 20) { exclude(args); return; }
  if (!positive(args.price) || !args.pair) { exclude(args); console.log('[CompactOutcomes] EXCLUDED reason=NO_COMPARABLE_BASELINE feed=' + args.feed); return; }
  registering = true; registrations++;
  try {
    const { supabase } = await import('./supabase.js');
    const { data, error } = await supabase.rpc('alpha_register_compact_alert', {
      p_chain: args.chain, p_token: args.token, p_feed: args.feed.slice(0,64),
      p_price: positive(args.price), p_mc: positive(args.marketCap), p_liquidity: positive(args.liquidity),
      p_pair: args.pair, p_unit: args.unit ?? 'USD', p_creator: args.creator ?? null, p_creator_source: args.creatorSource ?? null,
    }).abortSignal(AbortSignal.timeout(2000));
    if (error) throw error;
    if (['REGISTERED','REUSED','KNOWN_WINNER'].includes(data)) {
      if (seen.size >= 500) seen.delete(seen.keys().next().value!);
      seen.set(key, now + 6 * 60 * 60000);
    } else exclude(args);
    console.log('[CompactOutcomes] ADMISSION', { chain: args.chain, token: args.token, status: data });
  } catch { pausedUntil = Date.now() + 60000; exclude(args); console.warn('[CompactOutcomes] admission unavailable; paused for 60s'); }
  finally { registering = false; }
}

export function selectCompactPair(pairs: unknown, row: Pick<CompactTrackingRow,'chain'|'token'|'pair_id'>): Record<string, any> | null {
  if (!Array.isArray(pairs)) return null;
  return pairs.find(p => p && p.chainId === row.chain
    && String(p.baseToken?.address ?? '')[row.chain === 'solana' ? 'toString' : 'toLowerCase']() === (row.chain === 'solana' ? row.token : row.token.toLowerCase())
    && (row.chain === 'solana' ? String(p.pairAddress ?? '') === row.pair_id : String(p.pairAddress ?? '').toLowerCase() === row.pair_id.toLowerCase())) ?? null;
}
export function compactCheckpointIsLate(row: CompactTrackingRow, now: number): boolean {
  return now - Date.parse(row.started_at) > [15,60,360][row.checkpoint] * 60000 + 5 * 60000;
}
export function classifyCompactOutcome(baseline: number, samples: CompactSample[]): 'WINNER'|'FAILED'|'NEUTRAL'|'INCOMPLETE' {
  if (!positive(baseline) || samples.length !== 3 || samples.some(s=>s.status !== 'MEASURED' || !positive(s.price))) return 'INCOMPLETE';
  const roi = samples.map(s=>(s.price! / baseline - 1)*100);
  const low = Math.min(0,...roi); const final = roi[2];
  return final >= 25 && low >= -30 ? 'WINNER' : final <= -50 || low <= -80 ? 'FAILED' : 'NEUTRAL';
}
// Prospective shadow status uses only evidence available at this checkpoint.
// Price and LP can co-move mechanically; this is not independent demand proof.
export function compactShadowStatus(row: CompactTrackingRow, sample: CompactSample): NonNullable<CompactSample['shadow']> {
  if (row.price_unit !== 'USD' || sample.status !== 'MEASURED' || !positive(sample.price)
    || !positive(row.baseline_price) || !positive(sample.liquidity) || !positive(row.baseline_liquidity)
    || !Number.isFinite(Date.parse(row.started_at)) || !Number.isFinite(Date.parse(sample.at)) || Date.parse(sample.at) <= Date.parse(row.started_at)) return 'UNCONFIRMED';
  const priceRatio = sample.price! / row.baseline_price;
  const lpRatio = sample.liquidity! / row.baseline_liquidity!;
  if (priceRatio <= 0.5 || lpRatio <= 0.5) return 'DETERIORATING';
  return priceRatio > 1 && lpRatio >= 1 ? 'STRENGTHENING' : 'UNCONFIRMED';
}
async function measure(row: CompactTrackingRow): Promise<RunnerSample> {
  const sample: CompactSample = { status:'UNAVAILABLE',price:null,mc:null,liquidity:null,at:new Date().toISOString() };
  if (compactCheckpointIsLate(row, Date.now())) return {...sample,reason:'MISSED_CHECKPOINT_WINDOW'};
  try {
    if (row.price_unit === 'ETH_RESERVE_RATIO') {
      const { readPonsV2Curve } = await import('../chains/robinhood/ponsNormalAlertFastLane.js');
      const curve = await readPonsV2Curve({ token_address:row.token,curve_address:row.pair_id } as any);
      const price = curve && !curve.graduated ? positive(Number(curve.quoteReserve)/Number(curve.tokenReserve)) : null;
      return {...sample,status:price ? 'MEASURED':'UNAVAILABLE',price,reason:price ? undefined:'CURVE_UNAVAILABLE_OR_GRADUATED'};
    }
    const response = await governedDexScreenerJson<any>({
      url:`https://api.dexscreener.com/token-pairs/v1/${row.chain}/${encodeURIComponent(row.token)}`,
      caller:'compact_alert_outcomes',endpoint:'COMPACT_OUTCOME_PAIRS',priority:'BACKGROUND',
      cacheKey:`compact-outcome:${row.chain}:${row.token}`,cacheTtlMs:30000,signal:AbortSignal.timeout(5000),queueWaitTimeoutMs:750,
    });
    const pair = selectCompactPair(response.value, row); const price = positive(pair?.priceUsd);
    return {...sample,status:price ? 'MEASURED':'UNAVAILABLE',price,mc:positive(pair?.marketCap),liquidity:positive(pair?.liquidity?.usd),at:response.fetchedAt,
      name:typeof pair?.baseToken?.name==='string'?pair.baseToken.name.slice(0,48):undefined,symbol:typeof pair?.baseToken?.symbol==='string'?pair.baseToken.symbol.slice(0,20):undefined,
      reason:price ? undefined:'EXACT_PAIR_DATA_UNAVAILABLE'};
  } catch { return {...sample,reason:'PROVIDER_UNAVAILABLE'}; }
}

// Called by the existing PONS collection timer; no second worker or server.
export async function runCompactOutcomeCycle(): Promise<void> {
  if (!compactOutcomesEnabled() || running || Date.now() < pausedUntil) return;
  running = true;
  try {
    const { supabase } = await import('./supabase.js');
    if (Date.now()-maintainedAt>=5*60000) {
      const batch = [...excluded.values()].map(item => ({...item}));
      // Coverage is best effort: clear before sending to avoid double counting an ambiguous RPC.
      excluded.clear();
      const { error } = await supabase.rpc('alpha_compact_maintenance',{p_excluded:batch}).abortSignal(AbortSignal.timeout(2000));
      if (error) throw error;
      maintainedAt=Date.now();
    }
    const { data, error } = await supabase.rpc('alpha_claim_compact_checks').abortSignal(AbortSignal.timeout(2000));
    if (error) throw error;
    for (const row of (data ?? []) as CompactTrackingRow[]) {
      const sample = await measure(row);
      const retry = sample.status==='UNAVAILABLE' && sample.reason!=='MISSED_CHECKPOINT_WINDOW' && !row.retried;
      // Reuse the existing bounded checkpoint JSON; no new requests, rows or timer.
      const {name,symbol,...storedSample}=sample;
      storedSample.shadow = compactShadowStatus(row, sample);
      const result = await supabase.rpc('alpha_finish_compact_check',{p_chain:row.chain,p_token:row.token,p_lease:row.lease,p_sample:storedSample,p_retry:retry}).abortSignal(AbortSignal.timeout(2000));
      if (result.error) throw result.error;
      if(['CHECKPOINT','WINNER','FAILED','NEUTRAL','INCOMPLETE'].includes(result.data))void processCompactRunner(row,sample).catch(()=>console.warn('[RunnerCard] milestone delivery unavailable'));
      console.log('[CompactOutcomes] CHECKPOINT',{chain:row.chain,token:row.token,slot:row.checkpoint,result:result.data,shadow:storedSample.shadow});
    }
    console.log('[CompactOutcomes] CYCLE',{claimed:data?.length??0,maxActive:20,maxPerMinute:2});
  } catch { pausedUntil=Date.now()+60000; console.warn('[CompactOutcomes] cycle unavailable; paused for 60s'); }
  finally { running=false; }
}
