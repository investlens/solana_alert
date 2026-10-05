import { needsVenueConfirmation, type LaunchVenue } from './market-provenance.ts';

export type RecordRow = {
  asset_id: string | null; chain: string | null; risk_score?: unknown;
  confidence?: unknown; raw_data?: unknown; updated_at?: string | null;
  created_at?: string | null; source_agent?: string | null; status?: string | null;
};
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export function nonnegative(value: unknown): number | null {
  const n = finiteNumber(value); return n !== null && n >= 0 ? n : null;
}
export function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
export function addressKey(value: string): string {
  return /^0x[0-9a-f]+$/i.test(value) ? value.toLowerCase() : value;
}
export function validDate(value: unknown, now = Date.now()): string | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms <= now + 60_000 ? new Date(ms).toISOString() : null;
}
function count(value: unknown): number | null {
  const n = nonnegative(value); return n !== null && Number.isInteger(n) ? n : null;
}
function stat(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) { const n = nonnegative(record[key]); if (n !== null) return n; }
  return null;
}
export function chartFor(raw: Record<string, unknown>, chain: string): string | null {
  const pair = textValue(raw.pairAddress), url = textValue(raw.chartUrl);
  if (!pair || !url) return null;
  try {
    const parsed = new URL(url), segments = parsed.pathname.split('/').filter(Boolean);
    return parsed.protocol === 'https:' && parsed.hostname === 'dexscreener.com'
      && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
      && segments.length === 2 && segments[0] === chain
      && addressKey(segments[1]) === addressKey(pair) ? parsed.toString() : null;
  } catch { return null; }
}
// A recorded snapshot is not a live quote or a security audit. Never fill missing
// snapshot fields from an older alert, memory record, or previous observation.
export function recordedMarket(row: RecordRow, launch?: LaunchVenue, launchLookupFailed = false, now = Date.now()) {
  const raw = object(row.raw_data), token = row.asset_id ?? '', chain = row.chain ?? 'unknown';
  const embeddedToken = textValue(raw.tokenAddress ?? raw.token_address ?? raw.token ?? raw.address ?? raw.mint);
  const embeddedChain = textValue(raw.chain);
  const identityMatches = (!embeddedToken || addressKey(embeddedToken) === addressKey(token))
    && (!embeddedChain || embeddedChain.toLowerCase() === chain.toLowerCase());
  const observations = Array.isArray(raw.observations) ? raw.observations.map(object) : [];
  const dated = observations.map(value => ({ value, date: validDate(value.observedAt, now) }))
    .filter((v): v is {value: Record<string, unknown>; date: string} => v.date !== null)
    .sort((a,b) => Date.parse(b.date) - Date.parse(a.date));
  // If an observation array exists but has no valid time, do not manufacture one
  // from the row's database-write timestamp.
  const latest = dated[0];
  const observedAt = observations.length ? latest?.date ?? null
    : validDate(raw.observedAt ?? raw.marketObservedAt ?? row.updated_at, now);
  const stats = observations.length ? latest?.value ?? {} : raw;
  const venueEvidence = object(raw.marketEvidence);
  const venueTime = validDate(venueEvidence.observedAt, now);
  const venueSnapshotMatches = !launch?.curve_address || (!!venueTime && !!observedAt && Math.abs(Date.parse(venueTime)-Date.parse(observedAt)) <= 60_000);
  const venuePending = !identityMatches || !observedAt || (chain === 'robinhood'
    && (launchLookupFailed || !venueSnapshotMatches || needsVenueConfirmation(launch, raw)));
  const state = textValue(raw.intelligenceState ?? raw.state) ?? row.status ?? 'UNKNOWN';
  const score = finiteNumber(row.risk_score);
  const riskScore = score !== null && score >= 0 && score <= 100 ? score : null;
  const explicitRisk = String(raw.risk_level ?? raw.riskLevel ?? '').toUpperCase();
  const riskLevel = !identityMatches ? 'UNKNOWN' : state.toUpperCase() === 'DANGER'
    || explicitRisk === 'CRITICAL' || (riskScore !== null && riskScore > 70) ? 'HIGH'
    : ['LOW','MEDIUM','HIGH'].includes(explicitRisk) ? explicitRisk
    : riskScore === null ? 'UNKNOWN' : riskScore <= 35 ? 'LOW' : 'MEDIUM';
  const confidence = finiteNumber(row.confidence);
  const usable = !venuePending;
  const chartUrl = identityMatches ? chartFor(raw, chain) : null;
  // Top-level cap is used only when it accompanies the latest observation.
  const rowTime = validDate(row.updated_at, now);
  const sameWrite = !!observedAt && !!rowTime && Math.abs(Date.parse(rowTime)-Date.parse(observedAt)) <= 60_000;
  const marketCap = stat(stats, 'marketCap', 'market_cap', 'mcap')
    ?? (observations.length && sameWrite ? stat(raw, 'marketCap', 'market_cap', 'mcap') : null);
  return {
    token, chain, identityMatches, state, observedAt,
    stale: observedAt === null || now - Date.parse(observedAt) > 5 * 60_000,
    venuePending, launchpad: launch && addressKey(launch.token_address) === addressKey(token) && launch.chain === chain ? 'PONS' : null,
    source: chartUrl ? 'Recorded DEX observation · active venue unverified' : 'Recorded observation · source unverified',
    chartUrl: venuePending ? null : chartUrl,
    confidence: usable && confidence !== null && confidence >= 0 && confidence <= 100 ? confidence : null,
    riskScore: identityMatches ? riskScore : null, riskLevel,
    price: usable ? stat(stats, 'price', 'currentPrice') : null,
    marketCap: usable ? marketCap : null,
    liquidity: usable ? stat(stats, 'liquidity', 'liquidityUsd', 'liquidity_usd') : null,
    volume5m: usable ? stat(stats, 'volume5m', 'volume_5m') : null,
    buys5m: usable ? count(stats.buys5m ?? stats.buys_5m) : null,
    sells5m: usable ? count(stats.sells5m ?? stats.sells_5m) : null,
    peakMarketCap: usable ? stat(raw, 'peakMarketCap', 'peak_market_cap') : null,
  };
}
