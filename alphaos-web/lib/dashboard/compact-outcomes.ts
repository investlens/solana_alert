import { addressKey, nonnegative, object, textValue, validDate } from './recorded-market.ts';
import { mapRecordedOutcome } from './recorded-outcomes.ts';
type Row = Record<string, unknown>;

// Compact registrations happen only after Telegram acceptance. Match the specific
// event, not merely its token: compact tracking deduplicates across later alerts.
export function mapTrackedOutcome(event: Row, checkpoints: Row[], delivered: boolean, compact: Row[], identities: Row[], now = Date.now()) {
  const chain = textValue(event.chain)?.toLowerCase();
  const token = textValue(event.asset_id) ?? '';
  const key = (address: string) => chain === 'solana' ? address : addressKey(address);
  const time = validDate(event.alerted_at, now);
  const type = textValue(event.semantic_event_type) ?? textValue(event.alert_type);
  const matches = compact.filter(row => row.chain === chain && key(String(row.token)) === key(token)
    && row.feed === type && time && validDate(row.started_at, now)
    && Math.abs(Date.parse(String(row.started_at)) - Date.parse(time)) <= 5_000);
  const tracking = matches.length === 1 ? matches[0] : undefined;
  const identity = identities.find(row => row.chain === chain && key(String(row.token_address)) === key(token));
  const enriched = { ...event, symbol: event.symbol ?? identity?.symbol, token_name: event.token_name ?? identity?.name };
  const raw = object(event.raw_snapshot);
  const accepted = typeof raw.acceptedRecipients === 'number' && Number.isInteger(raw.acceptedRecipients) && raw.acceptedRecipients > 0
    && raw.deliveryMode === 'RECOVERY';
  // Reserve ratios are ETH/token, not USD; never display them as dollar prices.
  if (!tracking || tracking.price_unit !== 'USD' || !nonnegative(tracking.baseline_price)) {
    return mapRecordedOutcome(enriched, checkpoints, delivered || accepted, now);
  }
  const entry = nonnegative(event.price);
  const baseline = nonnegative(tracking.baseline_price)!;
  // Contradictory baselines must not be silently overwritten.
  if (entry !== null && Math.abs(entry - baseline) / baseline > 0.001) {
    return mapRecordedOutcome(enriched, checkpoints, delivered || accepted, now);
  }
  const samples = Array.isArray(tracking.samples) ? tracking.samples : [];
  const points = samples.map((sample, index) => {
    const value = object(sample);
    return { alert_event_id: event.id, checkpoint_seconds: [900, 3600, 21600][index],
      current_price: value.price, measured_at: value.at, status: value.status,
      price_provenance: 'DEXSCREENER_VERIFIED_BASE_PAIR', completeness: { entryPrice: true, currentPrice: true } };
  });
  const result = mapRecordedOutcome({ ...enriched, price: baseline, price_provenance: 'DEXSCREENER_VERIFIED_BASE_PAIR' }, points, true, now);
  if (!result.measuredAt) result.trackingStatus = tracking.finalized_at ? 'No comparable checkpoint' : 'Checkpoint pending';
  return result;
}
