import { mapTrackedOutcome } from './compact-outcomes.ts';
import { addressKey, nonnegative } from './recorded-market.ts';
type Row = Record<string, unknown>;
export function verifiedWinners(events: Row[], tracking: Row[], identities: Row[], now = Date.now()) {
  const rows = events.flatMap(event => {
    const matches = tracking.filter(t => t.price_unit === 'USD' && t.chain === event.chain
      && addressKey(String(t.token)) === addressKey(String(event.asset_id))
      && t.feed === (event.semantic_event_type ?? event.alert_type)
      && Math.abs(Date.parse(String(t.started_at)) - Date.parse(String(event.alerted_at))) <= 5000);
    if (matches.length !== 1) return [];
    const baseline = nonnegative(matches[0].baseline_price), entry = nonnegative(event.price);
    if (!baseline || (entry !== null && Math.abs(entry-baseline)/baseline > .001)) return [];
    const row = mapTrackedOutcome(event, [], true, matches, identities, now);
    if (!row.alertPrice || !row.peakPrice || !row.currentPrice || !row.measuredAt || !row.peakObservedAt
      || row.peakPrice/row.alertPrice < 2) return [];
    return [{ ...row, multiple: row.peakPrice/row.alertPrice,
      latestMultiple: row.currentPrice/row.alertPrice,
      drawdown: (row.currentPrice/row.peakPrice-1)*100 }];
  }).sort((a,b) => b.multiple-a.multiple);
  const seen = new Set<string>();
  return rows.filter(row => { if(seen.has(row.identity)) return false; seen.add(row.identity); return true; });
}
export type Winner = ReturnType<typeof verifiedWinners>[number];
