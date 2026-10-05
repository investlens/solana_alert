import { addressKey, nonnegative, object, textValue, validDate } from './recorded-market.ts';
type Row = Record<string, unknown>;
const indexed = new Set(['DEXSCREENER_VERIFIED_BASE_PAIR', 'VERIFIED_MARKET_INDEX', 'DEX_BASE_V1']);
export function mapRecordedOutcome(event: Row, checkpoints: Row[], delivered: boolean, now = Date.now()) {
  const id = Number(event.id), token = textValue(event.asset_id) ?? '';
  const chain = textValue(event.chain)?.toLowerCase() ?? 'unknown';
  const alertedAt = validDate(event.alerted_at, now);
  const entry = nonnegative(event.price), provenance = textValue(event.price_provenance)?.toUpperCase();
  const comparable = (value: unknown) => {
    const other = textValue(value)?.toUpperCase();
    return !!provenance && !!other && ((indexed.has(provenance) && indexed.has(other))
      || (/^PONS_V\d+_CURVE_RESERVE_(RATIO|SPOT)$/.test(provenance) && provenance === other));
  };
  const measured = checkpoints.filter(row => {
    const time = validDate(row.measured_at, now), completeness = object(row.completeness);
    const price = nonnegative(row.current_price);
    return Number(row.alert_event_id) === id && row.status === 'MEASURED'
      && completeness.entryPrice === true && completeness.currentPrice === true
      && !!time && !!alertedAt && Date.parse(time) > Date.parse(alertedAt)
      && price !== null && price > 0 && comparable(row.price_provenance);
  }).sort((a,b) => Date.parse(String(b.measured_at))-Date.parse(String(a.measured_at)));
  const latest = entry !== null && entry > 0 ? measured[0] : undefined;
  const currentPrice = latest ? nonnegative(latest.current_price) : null;
  // Recompute from comparable checkpoint prices; never trust seeded ROI or a mixed-venue peak.
  const prices = latest ? measured.map(row => nonnegative(row.current_price)).filter((n): n is number => n !== null && n > 0) : [];
  const peakPrice = prices.length && entry !== null ? Math.max(entry, ...prices) : null;
  const change = (price: number | null) => entry !== null && entry > 0 && price !== null ? (price/entry-1)*100 : null;
  const raw = object(event.raw_snapshot);
  return { id: `event-${id}`, token, chain, symbol: textValue(event.symbol) ?? textValue(raw.symbol) ?? `${token.slice(0,6)}…${token.slice(-4)}`,
    name: textValue(event.token_name), alertPrice: entry, currentPrice, peakPrice,
    roiNow: change(currentPrice), roiHigh: change(peakPrice), alertedAt,
    alertType: textValue(event.semantic_event_type) ?? textValue(event.alert_type) ?? 'EVENT',
    measuredAt: latest ? validDate(latest.measured_at, now) : null,
    checkpointSeconds: latest ? nonnegative(latest.checkpoint_seconds) : null,
    deliveryStatus: delivered ? 'Delivery recorded' : 'Event recorded · delivery unconfirmed',
    trackingStatus: latest ? 'Measured checkpoint' : 'Not tracked',
    identity: `${chain}:${addressKey(token)}` };
}
