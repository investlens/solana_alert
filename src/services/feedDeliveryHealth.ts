import {createPromotionEventAudit,type PromotionAuditSnapshot,type PromotionAuditStage} from './promotionEventAudit.js';
import { getSharedJson, setSharedJson } from './sharedJsonCache.js';
import { escapeTelegramHtml as esc } from '../ui/escapeHtml.js';

export type DeliveryStage = 'ENABLED' | 'MUTED' | 'PREFERENCES_UNAVAILABLE' | 'ACCEPTED' | 'PROCESSING_FAILED'
  | 'DISCOVERED' | 'EVALUATED' | 'DATA_UNAVAILABLE' | 'CONDITION_WAIT' | 'RISK_REJECTED' | 'QUALIFIED' | 'DEDUPLICATED' | 'UNCONFIRMED';
export type FeedPoll = {observedAt:number;status:'OK'|'UNAVAILABLE';items:number};
export type FeedHealthSnapshot = { startedAt: number; observedAt: number; feeds: Record<string, Partial<Record<DeliveryStage, number>>>; polls?:Record<string,FeedPoll>; promotions?:PromotionAuditSnapshot };
const startedAt = Date.now();
const promotionAudit=createPromotionEventAudit(128,3_600_000,startedAt);
const feeds: FeedHealthSnapshot['feeds'] = {};
const polls:Record<string,FeedPoll>={};
let lastPublish = 0;
let lastObserved = startedAt;
let publishTimer: ReturnType<typeof setTimeout> | undefined;
function publish() {
  lastPublish=Date.now();
  const snapshot=localFeedHealth();
  console.log('[FeedDeliveryHealth]',JSON.stringify(snapshot));
  const service=process.env.RAILWAY_SERVICE_ID;
  if(service) void setSharedJson(`alphaos:feed-health:${service}`,snapshot,new Date(lastPublish).toISOString(),3_600_000);
}
const workers = [
  ['Main', 'ff20240d-fd6c-4584-b05e-5394bdfa06df'],
  ['PONS', 'a655d7e1-4f12-4c7f-b80e-ed0e0e802e4b'],
  ['ARC', 'e127922b-fff0-4799-90b3-810915666516'],
] as const;

// Aggregate counters only: no users, tokens, raw events or database writes.
// At most one cache publication per worker/minute; no additional polling loop.
export function recordFeedDelivery(feed: string, stage: DeliveryStage, amount = 1): void {
  if (!/^[A-Z_]{2,40}$/.test(feed) || !Number.isSafeInteger(amount) || amount <= 0) return;
  if (!feeds[feed] && Object.keys(feeds).length >= 32) return;
  const row = feeds[feed] ??= {};
  row[stage] = Math.min(Number.MAX_SAFE_INTEGER, (row[stage] ?? 0) + amount);
  schedulePublish();
}
function schedulePublish() {
  const now = Date.now(); lastObserved = now;
  if (now - lastPublish < 60_000) {
    if (!publishTimer) { publishTimer=setTimeout(()=>{publishTimer=undefined;publish();},60_001-(now-lastPublish)); publishTimer.unref(); }
    return;
  }
  if (publishTimer) { clearTimeout(publishTimer); publishTimer=undefined; }
  publish();
}
// Fixed source names and aggregate counts only. Zero rows is a healthy quiet
// observation, not a token rejection or a successful Telegram delivery.
export function recordFeedPoll(source:string,status:FeedPoll['status'],items=0):void {
  if(!/^[A-Z_]{2,40}$/.test(source)||!['OK','UNAVAILABLE'].includes(status)||!Number.isSafeInteger(items)||items<0)return;
  if(!polls[source]&&Object.keys(polls).length>=32)return;
  polls[source]={observedAt:Date.now(),status,items};schedulePublish();
}
export function recordPromotionAudit(feed:string,identity:string,stage:PromotionAuditStage):void {
 if(promotionAudit.record(feed,identity,stage))schedulePublish();
}
export function localFeedHealth(now = Date.now()): FeedHealthSnapshot {
  return { startedAt, observedAt: lastObserved, feeds: structuredClone(feeds),polls:structuredClone(polls),promotions:promotionAudit.snapshot(now) };
}
export function renderFeedHealth(rows: Array<{ name: string; snapshot: FeedHealthSnapshot | null }>, now = Date.now()): string {
  const lines = ['📡 <b>ALERT DELIVERY HEALTH</b>', 'Screening and recipient counters since each worker restart · Cache snapshots', ''];
  for (const { name, snapshot } of rows) {
    lines.push(`<b>${esc(name)}</b>`);
    if (!snapshot || !Number.isFinite(snapshot.observedAt) || now < snapshot.observedAt || now - snapshot.observedAt > 3_600_000) {
      lines.push('No recent diagnostic snapshot · Health unknown', ''); continue;
    }
    for(const [source,poll] of Object.entries(snapshot.polls??{}).slice(0,12)) {
      if(lines.join('\n').length>2600)break;
      const age=Math.max(0,Math.floor((now-poll.observedAt)/1000));
      lines.push(`${esc(source.replace(/_/g,' '))}: ${age>180?'STALE':poll.status} · ${poll.items} rows · ${age}s ago`);
    }
    if(snapshot.promotions){
      const audit=snapshot.promotions;
      for(const feed of [...new Set(audit.entries.map(row=>row.feed))].slice(0,4)){
        const entries=audit.entries.filter(row=>row.feed===feed);
        const count=(stage:PromotionAuditStage)=>entries.filter(row=>row.stage===stage).length;
        lines.push(`${esc(feed.replace(/_/g,' '))} unique observed events: ${entries.length} · delivered ${count('DELIVERED')} · watched ${count('WATCHED')} · blocked ${count('BLOCKED')} · delivery pending ${count('DELIVERY_PENDING')} · ready ${count('READY')} · observed ${count('OBSERVED')} · expired ${count('EXPIRED')}`);
      }
      lines.push(`Event window: up to 1h since restart · cap ${audit.limit} · capacity evictions ${audit.capacityEvicted} · aged out ${audit.expired}`);
    }
    if (!Object.keys(snapshot.feeds).length) lines.push('No recipient attempts recorded by this worker yet.');
    lines.push(`Snapshot ${new Date(snapshot.observedAt).toISOString().slice(11, 19)} UTC`);
    for (const [feed, row] of Object.entries(snapshot.feeds).slice(0, 16)) {
      if (lines.join('\n').length > 3000) { lines.push('Additional feed counters omitted from this compact view.'); break; }
      lines.push(`${esc(feed.replace(/_/g, ' '))}: eligible ${row.ENABLED ?? 0} · muted ${row.MUTED ?? 0} · preference errors ${row.PREFERENCES_UNAVAILABLE ?? 0} · accepted ${row.ACCEPTED ?? 0} · processing errors ${row.PROCESSING_FAILED ?? 0}`);
      if (row.DEDUPLICATED || row.UNCONFIRMED) lines.push(`Already confirmed ${row.DEDUPLICATED ?? 0} · unconfirmed claims ${row.UNCONFIRMED ?? 0} (requires delivery review)`);
      if (row.EVALUATED || row.DISCOVERED) lines.push(`Screening: discovered ${row.DISCOVERED ?? 0} · evaluated ${row.EVALUATED ?? 0} · data unavailable ${row.DATA_UNAVAILABLE ?? 0} · waiting ${row.CONDITION_WAIT ?? 0} · risk rejects ${row.RISK_REJECTED ?? 0} · qualified ${row.QUALIFIED ?? 0}`);
    }
    lines.push('');
  }
  lines.push('Poll rows are observations, not new purchases or unique tokens. Screening counters count checks, not unique tokens. Eligible does not mean sent; dedup and scheduling can intervene.', 'Accepted means Telegram accepted the send. No snapshot does not mean no qualifying tokens.');
  return lines.join('\n');
}
export async function getFeedHealthText(): Promise<string> {
  const rows = await Promise.all(workers.map(async ([name, id]) => ({ name,
    snapshot: id === process.env.RAILWAY_SERVICE_ID ? localFeedHealth() : (await getSharedJson<FeedHealthSnapshot>(`alphaos:feed-health:${id}`))?.value ?? null })));
  return renderFeedHealth(rows);
}
