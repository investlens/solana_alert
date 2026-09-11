import { supabase } from './supabase.js';

const POLL_MS = 5 * 60_000;
const ROBINHOOD_STALE_MINUTES = 10;
const DEX_PAID_DELIVERY_GRACE_MINUTES = 5;

async function latestTimestamp(table: string, column: string, filters: Array<[string,string]> = []): Promise<string | null> {
  let query = supabase.from(table).select(column).order(column, { ascending: false }).limit(1);
  for (const [key, value] of filters) query = query.eq(key, value);
  const { data, error } = await query;
  if (error) throw error;
  return (data?.[0] as Record<string, string> | undefined)?.[column] ?? null;
}

function ageMinutes(value: string | null): number | null {
  if (!value) return null;
  return (Date.now() - new Date(value).getTime()) / 60_000;
}

async function setHealth(service: string, status: 'healthy'|'warning'|'critical', message: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from('system_health').upsert({
    service, status, message, last_seen_at: now, updated_at: now,
  }, { onConflict: 'service' });
  if (error) console.warn('[SystemWatchdog] health write failed', { service, reason: error.message });
}

async function checkRobinhoodPipeline(): Promise<void> {
  const latestEvent = await latestTimestamp('alpha_alert_events', 'created_at', [['chain','robinhood']]);
  const age = ageMinutes(latestEvent);
  if (age == null || age > ROBINHOOD_STALE_MINUTES) {
    await setHealth('robinhood_pipeline', 'critical', `Robinhood event stream stale: ${age == null ? 'no events' : `${age.toFixed(1)}m`}`);
    console.error('[SystemWatchdog] Robinhood event stream stale', { latestEvent, ageMinutes: age });
    return;
  }

  const cutoff = new Date(Date.now() - DEX_PAID_DELIVERY_GRACE_MINUTES * 60_000).toISOString();
  const { data: events, error: eventError } = await supabase.from('alpha_alert_events')
    .select('id,created_at').eq('chain','robinhood').eq('semantic_event_type','DEX_PAID').lte('created_at', cutoff)
    .gte('created_at', new Date(Date.now() - 60 * 60_000).toISOString()).order('created_at',{ascending:false}).limit(10);
  if (eventError) throw eventError;

  const ids = (events ?? []).map((row: any) => Number(row.id));
  let delivered = 0;
  if (ids.length) {
    const { count, error } = await supabase.from('alpha_alert_event_deliveries')
      .select('id', { count: 'exact', head: true }).in('alert_event_id', ids).not('delivered_at','is',null);
    if (error) throw error;
    delivered = count ?? 0;
  }

  if (ids.length > 0 && delivered === 0) {
    await setHealth('robinhood_pipeline', 'warning', `Robinhood discovery active but ${ids.length} recent DEX_PAID events have zero confirmed Telegram deliveries`);
    console.warn('[SystemWatchdog] Robinhood delivery gap', { recentDexPaidEvents: ids.length, confirmedDeliveries: delivered });
    return;
  }

  await setHealth('robinhood_pipeline', 'healthy', `Robinhood events fresh${ids.length ? `; ${delivered} confirmed DEX_PAID deliveries in recent sample` : '; no mature DEX_PAID events in sample'}`);
}

async function checkLearningPipeline(): Promise<void> {
  const latestShadow = await latestTimestamp('shadow_intelligence_decisions','created_at');
  const age = ageMinutes(latestShadow);
  await setHealth('shadow_ai_v2', age != null && age <= 30 ? 'healthy' : 'warning',
    age == null ? 'No V2 shadow decisions recorded' : `Latest V2 shadow decision ${age.toFixed(1)}m ago`);
}

async function cycle(): Promise<void> {
  const checks = [checkRobinhoodPipeline, checkLearningPipeline];
  for (const check of checks) {
    try { await check(); }
    catch (error) { console.warn('[SystemWatchdog] check failed but runtime continues:', error instanceof Error ? error.message : String(error)); }
  }
}

let started = false;
export function startSystemWatchdog(): void {
  if (started) return;
  started = true;
  const run = () => void cycle().catch(error => console.warn('[SystemWatchdog] cycle failed:', error instanceof Error ? error.message : String(error)));
  run();
  setInterval(run, Number(process.env.SYSTEM_WATCHDOG_POLL_MS ?? POLL_MS));
  console.log('[SystemWatchdog] Started. Monitoring Robinhood delivery and V2 learning freshness.');
}
