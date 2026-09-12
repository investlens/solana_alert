import { chooseBestPair, fetchPairs } from './dexscreener.js';
import { getRobinhoodMarketSnapshot } from '../chains/robinhood/market.js';
import { supabase } from './supabase.js';
import { editTelegramMessage, sendTelegramWithMessageId, type InlineButton } from './telegram.js';
import { protectBackgroundPromise } from './backgroundPromiseSafety.js';

export const LIVE_TRACK_DURATION_MS = 15 * 60_000;
export const LIVE_TRACK_FAST_PHASE_MS = 2 * 60_000;
export const LIVE_TRACK_FAST_INTERVAL_MS = 15_000;
export const LIVE_TRACK_NORMAL_INTERVAL_MS = 30_000;
export const LIVE_TRACK_MARKET_STALE_MS = 75_000;
export const LIVE_TRACK_HYDRATION_BUDGET_MS = 1_200;
export const LIVE_TRACK_EVENT_HISTORY_LIMIT = 100;
export const LIVE_TRACK_EVENT_HISTORY_WINDOW_MS = 90 * 24 * 60 * 60_000;
const WORKER_TICK_MS = 5_000;
const MEANINGFUL_STATES = new Set([
  'MOMENTUM_ACCELERATING', 'ENTRY_CONFIRMING', 'BREAKOUT', 'RUNNER', 'MOMENTUM_WEAKENING',
  'DEV_SELL', 'MATERIAL_LIQUIDITY_DROP', 'TRACK_INVALIDATED',
]);

type NullableNumber = number | null;
export type LiveTrackSnapshot = {
  observedAt: string; source: string | null; name: string | null; symbol: string | null;
  price: NullableNumber; marketCap: NullableNumber; liquidity: NullableNumber; volume5m: NullableNumber;
  buys5m: NullableNumber; sells5m: NullableNumber; devHolding: NullableNumber; devBurn: NullableNumber;
  devSell: boolean | null; devTransfer: boolean | null; boostTotal: NullableNumber; dexPaid: boolean | null;
  intelligenceState: string | null; lifecycleState: string | null; chartUrl: string | null;
  fieldFreshness?: Record<string, { verifiedAt: string; source: string | null;
    semanticEventType?: string | null; verificationStatus?: string | null }>;
  marketRefreshMiss?: boolean;
};

export type LiveTrackSemanticEvent = {
  semantic_event_type?: string | null; intelligence_state?: string | null; boost_total?: number | string | null;
  raw_snapshot?: Record<string, unknown> | null; alerted_at?: string | null; created_at?: string | null;
  dev_holding_percent?: number | string | null; dev_holding_evidence?: string | null;
  burned_percent?: number | string | null; burn_evidence?: string | null;
  developer_transferred_percent?: number | string | null;
};

export type LiveTrackSession = {
  id: string; user_id: string; chain: 'solana' | 'robinhood'; token_address: string;
  opportunity_id: number | null; started_at: string; expires_at: string; status: string;
  telegram_chat_id: string; telegram_message_id: number | null; baseline: LiveTrackSnapshot;
  latest: LiveTrackSnapshot; peak: Record<string, unknown>; next_update_at: string; last_observed_at: string | null;
};

type OpportunityContext = { id: number; asset_id: string; chain: string | null; status: string | null;
  recommended_action: string | null; raw_data: Record<string, unknown> | null };
type TrackDependencies = {
  now: () => Date; market: (chain: string, token: string) => Promise<Partial<LiveTrackSnapshot> | null>;
  evidence: (chain: string, token: string, raw: Record<string, unknown> | null) => Promise<Partial<LiveTrackSnapshot>>;
  send: typeof sendTelegramWithMessageId; edit: typeof editTelegramMessage;
};

const MARKET_FIELDS = ['price', 'marketCap', 'liquidity', 'volume5m', 'buys5m', 'sells5m', 'name', 'symbol', 'chartUrl'] as const;
const INTELLIGENCE_FIELDS = ['devHolding', 'devBurn', 'devSell', 'devTransfer', 'boostTotal', 'dexPaid', 'intelligenceState', 'lifecycleState'] as const;

function finite(value: unknown): number | null { if (value == null || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function positive(value: unknown): number | null { const n = finite(value); return n != null && n > 0 ? n : null; }
function bool(value: unknown): boolean | null { return typeof value === 'boolean' ? value : null; }
function text(value: unknown): string | null { const result = typeof value === 'string' ? value.trim() : ''; return result && !/^unknown(?: token)?$/i.test(result) ? result : null; }
function html(value: unknown): string { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function rawNumber(raw: Record<string, unknown> | null, ...keys: string[]): number | null { for (const key of keys) { const value = finite(raw?.[key]); if (value != null) return value; } return null; }
function rawBool(raw: Record<string, unknown> | null, ...keys: string[]): boolean | null { for (const key of keys) { const value = bool(raw?.[key]); if (value != null) return value; } return null; }

export function nextLiveTrackDelayMs(startedAt: string | number | Date, now: string | number | Date): number {
  return new Date(now).getTime() - new Date(startedAt).getTime() < LIVE_TRACK_FAST_PHASE_MS ? LIVE_TRACK_FAST_INTERVAL_MS : LIVE_TRACK_NORMAL_INTERVAL_MS;
}

function pct(current: number | null, baseline: number | null): string { if (current == null || baseline == null || baseline <= 0) return '—'; const value = ((current / baseline) - 1) * 100; return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`; }
function peaks(existing: Record<string, unknown>, snapshot: LiveTrackSnapshot): Record<string, unknown> { const result = { ...existing }; for (const key of ['price','marketCap','liquidity','volume5m','boostTotal'] as const) { const value = snapshot[key]; if (value != null) result[key] = Math.max(finite(result[key]) ?? value, value); } return result; }
function mergeLiveTrackSnapshot(previous: LiveTrackSnapshot, incoming: LiveTrackSnapshot): LiveTrackSnapshot { const result = { ...previous, ...incoming, fieldFreshness: { ...(previous.fieldFreshness ?? {}), ...(incoming.fieldFreshness ?? {}) } }; for (const field of [...MARKET_FIELDS, ...INTELLIGENCE_FIELDS]) if (incoming[field] == null && previous[field] != null) (result as any)[field] = previous[field]; return result; }

async function marketSnapshot(chain: string, token: string): Promise<Partial<LiveTrackSnapshot> | null> { if (chain === 'robinhood') return getRobinhoodMarketSnapshot(token) as any; const pairs = await fetchPairs(token); const pair = chooseBestPair(pairs as any); if (!pair) return null; return { price: positive((pair as any).priceUsd), marketCap: positive((pair as any).marketCap ?? (pair as any).fdv), liquidity: positive((pair as any).liquidity?.usd), volume5m: positive((pair as any).volume?.m5), buys5m: finite((pair as any).txns?.m5?.buys), sells5m: finite((pair as any).txns?.m5?.sells), name: text((pair as any).baseToken?.name), symbol: text((pair as any).baseToken?.symbol), chartUrl: text((pair as any).url), source: 'DEXSCREENER' }; }

async function evidenceSnapshot(chain: string, token: string, raw: Record<string, unknown> | null): Promise<Partial<LiveTrackSnapshot>> { return { devHolding: rawNumber(raw,'devHolding','dev_holding_percent'), devBurn: rawNumber(raw,'devBurn','burned_percent'), devSell: rawBool(raw,'devSell','developer_sold'), devTransfer: rawBool(raw,'devTransfer','developer_transferred'), boostTotal: rawNumber(raw,'boostTotal','boost_total'), dexPaid: rawBool(raw,'dexPaid','dex_paid'), intelligenceState: text(raw?.intelligence_state), lifecycleState: text(raw?.lifecycle_state) }; }

const productionDependencies: TrackDependencies = { now: () => new Date(), market: marketSnapshot, evidence: evidenceSnapshot, send: sendTelegramWithMessageId, edit: editTelegramMessage };

export async function captureLiveTrackSnapshot(args: { chain: string; token: string; raw?: Record<string, unknown> | null }, dependencies: TrackDependencies = productionDependencies): Promise<LiveTrackSnapshot> { const observedAt = dependencies.now().toISOString(); const market = await dependencies.market(args.chain,args.token).catch(() => null); const evidence = await dependencies.evidence(args.chain,args.token,args.raw ?? null).catch(() => ({})); return { observedAt, source: text((market as any)?.source) ?? null, name: text((market as any)?.name), symbol: text((market as any)?.symbol), price: positive((market as any)?.price), marketCap: positive((market as any)?.marketCap), liquidity: positive((market as any)?.liquidity), volume5m: positive((market as any)?.volume5m), buys5m: finite((market as any)?.buys5m), sells5m: finite((market as any)?.sells5m), devHolding: finite((evidence as any)?.devHolding), devBurn: finite((evidence as any)?.devBurn), devSell: bool((evidence as any)?.devSell), devTransfer: bool((evidence as any)?.devTransfer), boostTotal: finite((evidence as any)?.boostTotal), dexPaid: bool((evidence as any)?.dexPaid), intelligenceState: text((evidence as any)?.intelligenceState), lifecycleState: text((evidence as any)?.lifecycleState), chartUrl: text((market as any)?.chartUrl), marketRefreshMiss: !market } as LiveTrackSnapshot; }

export function renderLiveTrackMessage(session: LiveTrackSession): string { return [`👁 <b>LIVE TRACK · ${html(session.latest.symbol ?? 'TOKEN')}</b>`,``,`<code>${html(session.token_address)}</code>`,`Price: <b>${pct(session.latest.price, session.baseline.price)}</b>`,`State: <b>${html(session.latest.intelligenceState ?? session.latest.lifecycleState ?? 'TRACKING')}</b>`].join('\n'); }
export function buildLiveTrackButtons(session: LiveTrackSession): InlineButton[][] { return [[{ text:'⏱ Extend 15m', callback_data:`LIVE_TRACK_EXTEND:${session.id}` },{ text:'✋ Stop', callback_data:`LIVE_TRACK_STOP:${session.id}` }]]; }

async function insertObservation(session: LiveTrackSession, snapshot: LiveTrackSnapshot, rawRefresh: LiveTrackSnapshot = snapshot): Promise<void> { const { error } = await supabase.from('alpha_live_track_observations').insert({ session_id: session.id, observed_at: snapshot.observedAt, elapsed_seconds: Math.max(0, Math.round((Date.parse(snapshot.observedAt) - Date.parse(session.started_at)) / 1000)), snapshot, source_freshness: { market: snapshot.source, market_observed_at: snapshot.fieldFreshness?.price?.verifiedAt ?? null, market_refresh_miss: rawRefresh.marketRefreshMiss === true, carried_forward_fields: MARKET_FIELDS.filter(field => rawRefresh[field] == null && snapshot[field] != null), raw_refresh: rawRefresh, intelligence: 'PERSISTED_CACHE_ONLY' } }); if (error) throw error; }

export function meaningfulLiveTrackTransitions(baseline: LiveTrackSnapshot, latest: LiveTrackSnapshot): string[] { const result: string[] = []; const state = latest.intelligenceState?.toUpperCase(); if (state && MEANINGFUL_STATES.has(state)) result.push(state); if (latest.devSell === true && baseline.devSell !== true) result.push('DEV_SELL'); if (baseline.liquidity != null && baseline.liquidity > 0 && latest.liquidity != null && latest.liquidity <= baseline.liquidity * .75) result.push('MATERIAL_LIQUIDITY_DROP'); if (baseline.price != null && baseline.price > 0 && latest.price != null) { const gain = latest.price / baseline.price - 1; for (const milestone of [20,50,100]) if (gain >= milestone/100) result.push(`MILESTONE_${milestone}`); } return [...new Set(result)]; }

async function notifyTransitions(session: LiveTrackSession, snapshot: LiveTrackSnapshot, dependencies: TrackDependencies): Promise<void> { for (const transition of meaningfulLiveTrackTransitions(session.baseline,snapshot)) { const { data,error } = await supabase.from('alpha_live_track_transitions').insert({ session_id:session.id,transition_key:transition,transition_type:transition,snapshot }).select('id').maybeSingle(); if(error){ if(String(error.code)==='23505') continue; throw error; } if(!data) continue; const messageId=await dependencies.send(session.telegram_chat_id,`👁 <b>LIVE TRACK UPDATE · ${html(transition.replace(/_/g,' '))}</b>\n\n<code>${html(session.token_address)}</code>\nPrice since Track: <b>${pct(snapshot.price,session.baseline.price)}</b>`); if(messageId!=null) await supabase.from('alpha_live_track_transitions').update({telegram_message_id:messageId}).eq('id',data.id); } }

export async function startLiveTrack(args: { userId:string; chatId:string; opportunity:OpportunityContext }, dependencies:TrackDependencies=productionDependencies): Promise<LiveTrackSession> { const chain=args.opportunity.chain==='robinhood'?'robinhood':'solana'; const now=dependencies.now(); const baseline=await captureLiveTrackSnapshot({chain,token:args.opportunity.asset_id,raw:args.opportunity.raw_data},{...dependencies,evidence:async()=>({})}); baseline.lifecycleState??=text(args.opportunity.recommended_action)??text(args.opportunity.status); if(baseline.price==null) throw new Error('Verified current price is unavailable; Track was not started.'); const expiresAt=new Date(now.getTime()+LIVE_TRACK_DURATION_MS).toISOString(); const row={user_id:args.userId,chain,token_address:args.opportunity.asset_id,opportunity_id:args.opportunity.id,started_at:now.toISOString(),expires_at:expiresAt,status:'ACTIVE',telegram_chat_id:args.chatId,baseline,latest:baseline,peak:peaks({},baseline),next_update_at:new Date(now.getTime()+LIVE_TRACK_FAST_INTERVAL_MS).toISOString(),last_observed_at:baseline.observedAt}; const existingResult=await supabase.from('alpha_live_track_sessions').select('id').eq('user_id',args.userId).eq('chain',chain).ilike('token_address',args.opportunity.asset_id).eq('status','ACTIVE').maybeSingle(); if(existingResult.error) throw existingResult.error; const mutation=existingResult.data?supabase.from('alpha_live_track_sessions').update(row).eq('id',existingResult.data.id):supabase.from('alpha_live_track_sessions').insert(row); const {data,error}=await mutation.select('*').single(); if(error) throw error; const session=data as LiveTrackSession; await insertObservation(session,baseline); const messageId=await dependencies.send(args.chatId,renderLiveTrackMessage(session),buildLiveTrackButtons(session)); if(messageId!=null){session.telegram_message_id=messageId;const update=await supabase.from('alpha_live_track_sessions').update({telegram_message_id:messageId}).eq('id',session.id);if(update.error)throw update.error;} return session; }

export async function updateLiveTrackSession(session:LiveTrackSession,dependencies:TrackDependencies=productionDependencies):Promise<void>{const now=dependencies.now();if(Date.parse(session.expires_at)<=now.getTime()){await supabase.from('alpha_live_track_sessions').update({status:'EXPIRED',updated_at:now.toISOString()}).eq('id',session.id);return;}const snapshot=await captureLiveTrackSnapshot({chain:session.chain,token:session.token_address},dependencies);const latest=mergeLiveTrackSnapshot(session.latest,snapshot);const next=new Date(now.getTime()+nextLiveTrackDelayMs(session.started_at,now)).toISOString();await insertObservation(session,latest,snapshot);const peak=peaks(session.peak,latest);const update=await supabase.from('alpha_live_track_sessions').update({latest,peak,last_observed_at:latest.observedAt,next_update_at:next,updated_at:now.toISOString()}).eq('id',session.id).eq('status','ACTIVE');if(update.error)throw update.error;const current={...session,latest,peak,next_update_at:next};if(session.telegram_message_id!=null)await dependencies.edit(session.telegram_chat_id,session.telegram_message_id,renderLiveTrackMessage(current),buildLiveTrackButtons(current));await notifyTransitions(current,latest,dependencies);}
export async function stopLiveTrack(sessionId:string,userId:string):Promise<boolean>{const{data,error}=await supabase.from('alpha_live_track_sessions').update({status:'STOPPED',updated_at:new Date().toISOString()}).eq('id',sessionId).eq('user_id',userId).eq('status','ACTIVE').select('id').maybeSingle();if(error)throw error;return Boolean(data);}
export async function extendLiveTrack(sessionId:string,userId:string):Promise<boolean>{const{data:existing,error:readError}=await supabase.from('alpha_live_track_sessions').select('expires_at').eq('id',sessionId).eq('user_id',userId).eq('status','ACTIVE').maybeSingle();if(readError)throw readError;if(!existing)return false;const expires_at=new Date(Math.max(Date.now(),Date.parse(existing.expires_at))+LIVE_TRACK_DURATION_MS).toISOString();const{data,error}=await supabase.from('alpha_live_track_sessions').update({expires_at,updated_at:new Date().toISOString()}).eq('id',sessionId).eq('user_id',userId).eq('status','ACTIVE').select('id').maybeSingle();if(error)throw error;return Boolean(data);}

let workerStarted=false;let workerRunning=false;
export async function runLiveTrackCycle(dependencies:TrackDependencies=productionDependencies):Promise<void>{if(workerRunning)return;workerRunning=true;try{const now=dependencies.now().toISOString();await supabase.from('alpha_live_track_sessions').update({status:'EXPIRED',updated_at:now}).eq('status','ACTIVE').lte('expires_at',now);const{data,error}=await supabase.from('alpha_live_track_sessions').select('*').eq('status','ACTIVE').lte('next_update_at',now).gt('expires_at',now).order('next_update_at').limit(20);if(error)throw error;for(const row of data??[])await updateLiveTrackSession(row as LiveTrackSession,dependencies).catch(error=>console.error('[LiveTrack] Session update failed:',{sessionId:row.id,reason:error instanceof Error?error.message:String(error)}));}finally{workerRunning=false;}}
export function startLiveTrackService():ReturnType<typeof setInterval>|null{
  if(process.env.LIVE_TRACK_WORKER_ENABLED==='false'){
    console.log('[LiveTrack] Background worker disabled; on-demand Track feature remains available.');
    return null;
  }
  if(workerStarted)return null;
  workerStarted=true;
  const runSafely=()=>protectBackgroundPromise('LiveTrack',runLiveTrackCycle());
  void runSafely();
  const timer=setInterval(()=>{void runSafely();},WORKER_TICK_MS);
  timer.unref?.();
  return timer;
}
