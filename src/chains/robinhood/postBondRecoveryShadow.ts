import type { SetupMarketEvidence } from './setupMarketEvidence.js';

// Frozen v1 research hypothesis. No orders, alerts, profitability claims or fetches.
export const RECOVERY_SHADOW_VERSION = 'postbond-v1';
const MAX_WATCHES = 20;
const MAX_AGE = 2 * 60 * 60_000;
const HORIZON = 60 * 60_000;
type Watch = { pair: string; started: number; basePrice: number; peak: number; low: number; dip: boolean; confirmations: number;
  previous: SetupMarketEvidence; signal?: { at: number; price: number; low: number; min: number; max: number } };
export type RecoveryShadowEvent = { kind: 'SIGNAL' | 'COMPLETE' | 'INCOMPLETE'; token: string; pair: string;
  at: number; version: string; referenceReturnPct?: number; baselineReferenceReturnPct?: number; minPct?: number; maxPct?: number;
  reason?: string; fillAssumed: false; feesSlippageIncluded: false };
const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export class PostBondRecoveryShadow {
  private watches = new Map<string, Watch>();
  private completed = new Map<string, number>();
  readonly counts = { observed: 0, dataUnavailable: 0, waiting: 0, signals: 0, complete: 0, incomplete: 0 };
  observe(token: string, market: SetupMarketEvidence, now: number): RecoveryShadowEvent[] {
    const events = this.expire(now);
    if (market.source !== 'DEX') return events;
    const key = token.toLowerCase();
    if (this.completed.has(key)) return events;
    if (!Number.isFinite(market.at) || market.at > now || now - market.at > 90_000
      || !valid(market.price) || market.price === 0 || !valid(market.depth) || market.depth === 0
      || !valid(market.marketCap) || market.marketCap === 0
      || !valid(market.volume5m) || !valid(market.volume24h) || market.volume5m > market.volume24h
      || !valid(market.buys5m) || !valid(market.sells5m)) {
      this.counts.dataUnavailable++; return events;
    }
    this.counts.observed++;
    let watch = this.watches.get(key);
    if (watch && watch.pair !== market.pair) {
      if (watch.signal) { events.push(this.finish(key, watch, now, 'PAIR_CHANGED')); return events; }
      this.watches.delete(key); watch = undefined;
    }
    if (!watch) {
      if (this.watches.size >= MAX_WATCHES) return events;
      this.watches.set(key, {pair:market.pair, started:now, basePrice:market.price, peak:market.price, low:market.price,
        dip:false, confirmations:0, previous:market}); return events;
    }
    if (market.at <= watch.previous.at) return events; // Cached reads are not new evidence.
    const gap = market.at - watch.previous.at;
    if (watch.signal) {
      watch.signal.min = Math.min(watch.signal.min, market.price);
      watch.signal.max = Math.max(watch.signal.max, market.price);
      watch.previous = market;
      if (gap > 180_000) events.push(this.finish(key, watch, now, 'OBSERVATION_GAP'));
      else if (market.price <= watch.signal.low) events.push(this.finish(key, watch, now, undefined));
      else if (market.at - watch.signal.at >= HORIZON) events.push(this.finish(key, watch, now, undefined));
      return events;
    }
    watch.peak = Math.max(watch.peak, market.price);
    // Only track the low after a 5% pullback from a peak observed on this DEX pair.
    if (!watch.dip && market.price <= watch.peak * .95) { watch.dip = true; watch.low = market.price; }
    else if (watch.dip) watch.low = Math.min(watch.low, market.price);
    const demand = gap >= 45_000 && gap <= 180_000 && market.price > watch.previous.price
      && market.depth >= watch.previous.depth * .98 && market.volume5m > (watch.previous.volume5m ?? Infinity)
      && market.buys5m! >= 3 && market.buys5m! > market.sells5m!;
    watch.confirmations = demand ? watch.confirmations + 1 : 0;
    watch.previous = market;
    if (watch.dip && watch.low <= watch.peak * .95 && watch.confirmations >= 2 && market.price >= watch.low * 1.03) {
      watch.signal = {at:market.at, price:market.price, low:watch.low, min:market.price, max:market.price};
      this.counts.signals++;
      events.push({kind:'SIGNAL', token:key, pair:watch.pair, at:market.at, version:RECOVERY_SHADOW_VERSION,
        fillAssumed:false, feesSlippageIncluded:false});
    } else this.counts.waiting++;
    return events;
  }
  expire(now: number): RecoveryShadowEvent[] {
    const events: RecoveryShadowEvent[] = [];
    for (const [token, watch] of this.watches) if (now - watch.started > MAX_AGE
      || (watch.signal && now - watch.previous.at > 180_000)) {
      if (watch.signal) events.push(this.finish(token, watch, now, 'OBSERVATION_EXPIRED'));
      else this.watches.delete(token);
    }
    for (const [key, at] of this.completed) if (now - at > 24 * 60 * 60_000) this.completed.delete(key);
    return events;
  }
  private finish(token: string, watch: Watch, at: number, reason?: string): RecoveryShadowEvent {
    const signal = watch.signal!;
    this.watches.delete(token);
    if (this.completed.size >= 100) this.completed.delete(this.completed.keys().next().value!);
    this.completed.set(token, at);
    this.counts[reason ? 'incomplete' : 'complete']++;
    return {kind:reason?'INCOMPLETE':'COMPLETE',token,pair:watch.pair,at,version:RECOVERY_SHADOW_VERSION,
      referenceReturnPct:reason?undefined:(watch.previous.price / signal.price - 1) * 100,
      baselineReferenceReturnPct:reason?undefined:(watch.previous.price / watch.basePrice - 1) * 100,
      minPct:(signal.min / signal.price - 1) * 100,maxPct:(signal.max / signal.price - 1) * 100,
      reason,fillAssumed:false,feesSlippageIncluded:false};
  }
  summary() { return {version:RECOVERY_SHADOW_VERSION,...this.counts,active:this.watches.size,
    maxActive:MAX_WATCHES, extraProviderRequests:0, databaseWrites:0, netProfitMeasured:false}; }
}
