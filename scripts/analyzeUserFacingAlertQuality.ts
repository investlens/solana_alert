import 'dotenv/config';
import { supabase } from '../src/services/supabase.js';

type EventRow = { id: number; opportunity_id: number | null; delivery_identity: string | null; semantic_event_type: string | null; alert_type: string; asset_id: string; symbol: string | null; alerted_at: string };
type DeliveryRow = { alert_event_id?: number; opportunity_id?: number; delivery_identity?: string; telegram_id: string; tier_at_delivery: 'admin' | 'paid' | 'free'; metadata?: Record<string, unknown>; delivered_at?: string | null };
type OutcomeRow = { alert_event_id: number; checkpoint_seconds: number; current_roi: number | string | null; status: string };

const USER_FACING_TYPES = new Set(['BOOST', 'MAJOR_BOOST', 'DEX_PAID', 'DEV_BURN', 'DEV_SELL', 'CRITICAL_RISK', 'LIQUIDITY_RISK', 'VOLUME_SURGE', 'VOLUME_IGNITION', 'OPPORTUNITY']);
const INTERNAL_TYPES = new Set(['BUILDING', 'CONFIRMED', 'RUNNER', 'COOLING', 'WEAKENING', 'DANGER', 'DEV_TRANSFER', 'WALLET_CLUSTER']);
const HORIZONS = [30, 60, 180, 300, 900, 1800, 3600];
const numberOrNull = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; };
const median = (values: number[]) => { const rows = [...values].sort((a, b) => a - b); if (!rows.length) return null; const middle = Math.floor(rows.length / 2); return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2; };
const percent = (part: number, total: number) => total ? `${(part / total * 100).toFixed(1)}%` : 'unavailable';

const hours = Math.max(1, Number(process.argv[2] ?? 24));
const since = new Date(Date.now() - hours * 3_600_000).toISOString();
const eventsResult = await supabase.from('alpha_alert_events').select('id,opportunity_id,delivery_identity,semantic_event_type,alert_type,asset_id,symbol,alerted_at').gte('alerted_at', since).order('alerted_at');
if (eventsResult.error) throw eventsResult.error;
const events = (eventsResult.data ?? []) as EventRow[];
const eventIds = events.map(row => row.id);
const opportunityIds = [...new Set(events.flatMap(row => row.opportunity_id == null ? [] : [row.opportunity_id]))];
const semanticDeliveries: DeliveryRow[] = []; const opportunityDeliveries: DeliveryRow[] = []; const outcomes: OutcomeRow[] = [];
for (let offset = 0; offset < eventIds.length; offset += 500) {
  const ids = eventIds.slice(offset, offset + 500); if (!ids.length) continue;
  const [deliveryResult, outcomeResult] = await Promise.all([
    supabase.from('alpha_alert_event_deliveries').select('alert_event_id,telegram_id,tier_at_delivery,delivered_at,metadata').in('alert_event_id', ids),
    supabase.from('alpha_alert_outcomes').select('alert_event_id,checkpoint_seconds,current_roi,status').in('alert_event_id', ids),
  ]);
  if (deliveryResult.error) throw deliveryResult.error; if (outcomeResult.error) throw outcomeResult.error;
  semanticDeliveries.push(...(deliveryResult.data ?? []) as DeliveryRow[]); outcomes.push(...(outcomeResult.data ?? []) as OutcomeRow[]);
}
for (let offset = 0; offset < opportunityIds.length; offset += 500) {
  const ids = opportunityIds.slice(offset, offset + 500); if (!ids.length) continue;
  const result = await supabase.from('opportunity_deliveries').select('opportunity_id,delivery_identity,telegram_id,tier_at_delivery,delivered_at,metadata').in('opportunity_id', ids);
  if (result.error) throw result.error; opportunityDeliveries.push(...(result.data ?? []) as DeliveryRow[]);
}

const semanticByEvent = new Map<number, DeliveryRow[]>();
for (const row of semanticDeliveries.filter(row => row.metadata?.state === 'DELIVERED')) semanticByEvent.set(row.alert_event_id!, [...(semanticByEvent.get(row.alert_event_id!) ?? []), row]);
const opportunityByIdentity = new Map<string, DeliveryRow[]>();
for (const row of opportunityDeliveries.filter(row => row.metadata?.state === 'DELIVERED')) { const key = `${row.opportunity_id}:${row.delivery_identity}`; opportunityByIdentity.set(key, [...(opportunityByIdentity.get(key) ?? []), row]); }
const outcomesByEvent = new Map<number, OutcomeRow[]>();
for (const row of outcomes) outcomesByEvent.set(row.alert_event_id, [...(outcomesByEvent.get(row.alert_event_id) ?? []), row]);
const deliveriesFor = (event: EventRow) => [...(semanticByEvent.get(event.id) ?? []), ...(event.opportunity_id == null ? [] : opportunityByIdentity.get(`${event.opportunity_id}:${event.delivery_identity}`) ?? [])];
const typeFor = (event: EventRow) => String(event.semantic_event_type ?? event.alert_type ?? 'UNKNOWN').toUpperCase();
const userFacing = events.filter(event => USER_FACING_TYPES.has(typeFor(event)) || deliveriesFor(event).length > 0);
const internal = events.filter(event => INTERNAL_TYPES.has(typeFor(event)) && deliveriesFor(event).length === 0);

console.log(`USER-FACING ALERT QUALITY — last ${hours}h`);
for (const type of [...new Set(userFacing.map(typeFor))].sort()) {
  const rows = userFacing.filter(event => typeFor(event) === type); const deliveries = rows.flatMap(deliveriesFor);
  console.log(`\n${type}`);
  console.log(`generated=${rows.length} delivered=${deliveries.length} uniqueUsers=${new Set(deliveries.map(row => row.telegram_id)).size}`);
  console.log(`recipients free=${deliveries.filter(row => row.tier_at_delivery === 'free').length} pro=${deliveries.filter(row => row.tier_at_delivery === 'paid').length} admin=${deliveries.filter(row => row.tier_at_delivery === 'admin').length}`);
  for (const horizon of HORIZONS) {
    const measured = rows.flatMap(event => { const outcome = (outcomesByEvent.get(event.id) ?? []).find(row => row.checkpoint_seconds === horizon); const roi = numberOrNull(outcome?.current_roi); return roi == null ? [] : [{ event, roi }]; });
    const values = measured.map(row => row.roi); const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const best = measured.reduce<(typeof measured)[number] | null>((current, row) => !current || row.roi > current.roi ? row : current, null);
    const worst = measured.reduce<(typeof measured)[number] | null>((current, row) => !current || row.roi < current.roi ? row : current, null);
    const label = horizon < 60 ? `${horizon}s` : horizon < 3600 ? `${horizon / 60}m` : '1h';
    console.log(`${label}: measured=${measured.length}/${rows.length} median=${median(values)?.toFixed(2) ?? 'unavailable'} avg=${average?.toFixed(2) ?? 'unavailable'} positive=${percent(values.filter(v => v > 0).length, values.length)} >=20=${percent(values.filter(v => v >= 20).length, values.length)} >=50=${percent(values.filter(v => v >= 50).length, values.length)} best=${best ? `${best.event.symbol ?? best.event.asset_id}:${best.roi.toFixed(2)}` : 'unavailable'} worst=${worst ? `${worst.event.symbol ?? worst.event.asset_id}:${worst.roi.toFixed(2)}` : 'unavailable'} unavailable=${percent(rows.length - measured.length, rows.length)}`);
  }
}
console.log('\nINTERNAL INTELLIGENCE OBSERVATIONS');
for (const type of [...new Set(internal.map(typeFor))].sort()) console.log(`${type}: generated=${internal.filter(event => typeFor(event) === type).length} delivered=0`);
