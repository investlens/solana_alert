import { supabase } from './supabase.js';

const POLL_MS = 5 * 60_000;
const ROBINHOOD_STALE_MINUTES = 10;
const DEX_PAID_DELIVERY_GRACE_MINUTES = 5;
const DEX_PAID_SAMPLE_MINUTES = 60;

async function latestTimestamp(table: string, column: string, filters: Array<[string,string]> = []): Promise<string | null> {
  let query = supabase.from(table).select(column).order(column, { ascending: false }).limit(1);
  for (const [key, value] of filters) query = query.eq(key, value);
  const { data, error } = await query;
  if (error) throw error;
  const row = data?.[0] as unknown as Record<string, unknown> | undefined;
  return typeof row?.[column] === 'string' ? row[column] as string : null;
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

  const sampleStart = new Date(Date.now() - DEX_PAID_SAMPLE_MINUTES * 60_000).toISOString();
  const matureCutoff = new Date(Date.now() - DEX_PAID_DELIVERY_GRACE_MINUTES * 60_000).toISOString();
  const { data: events, error: eventError } = await supabase.from('alpha_alert_events')
    .select('id,asset_id,created_at')
    .eq('chain','robinhood')
    .eq('semantic_event_type','DEX_PAID')
    .lte('created_at', matureCutoff)
    .gte('created_at', sampleStart)
    .order('created_at',{ascending:false})
    .limit(20);
  if (eventError) throw eventError;

  const observedEvents = (events ?? []).filter((row: any) => typeof row.asset_id === 'string' && row.asset_id.length > 0);
  const observedTokens = [...new Set(observedEvents.map((row: any) => String(row.asset_id).toLowerCase()))];

  const latestSnapshotByToken = new Map<string, { allowed: boolean; evaluated_at: string }>();
  if (observedTokens.length) {
    const { data: snapshots, error: snapshotError } = await supabase.from('robinhood_dex_paid_security_snapshots')
      .select('token_address,evaluated_at,allowed')
      .gte('evaluated_at', sampleStart)
      .order('evaluated_at', { ascending: false })
      .limit(200);
    if (snapshotError) throw snapshotError;

    const observedSet = new Set(observedTokens);
    for (const row of snapshots ?? []) {
      const token = String((row as any).token_address ?? '').toLowerCase();
      if (!token || !observedSet.has(token) || latestSnapshotByToken.has(token)) continue;
      latestSnapshotByToken.set(token, {
        allowed: (row as any).allowed === true,
        evaluated_at: String((row as any).evaluated_at ?? ''),
      });
    }
  }

  const approvedEventIds = observedEvents
    .filter((row: any) => latestSnapshotByToken.get(String(row.asset_id).toLowerCase())?.allowed === true)
    .map((row: any) => Number(row.id));

  let delivered = 0;
  if (approvedEventIds.length) {
    const { count, error } = await supabase.from('alpha_alert_event_deliveries')
      .select('id', { count: 'exact', head: true })
      .in('alert_event_id', approvedEventIds)
      .not('delivered_at','is',null);
    if (error) throw error;
    delivered = count ?? 0;
  }

  const observed = observedEvents.length;
  const approved = approvedEventIds.length;
  const blocked = Math.max(observed - approved, 0);
  console.log('[SystemWatchdog] Robinhood DEX_PAID safety disposition', {
    observed,
    approved,
    blocked,
    confirmedDeliveries: delivered,
  });

  if (approved > 0 && delivered === 0) {
    await setHealth('robinhood_pipeline', 'warning', `Robinhood discovery active; ${approved} safety-approved DEX_PAID event${approved === 1 ? '' : 's'} have zero confirmed Telegram deliveries`);
    console.warn('[SystemWatchdog] Robinhood approved delivery gap', { approvedDexPaidEvents: approved, confirmedDeliveries: delivered });
    return;
  }

  if (observed > 0 && approved === 0) {
    await setHealth('robinhood_pipeline', 'healthy', `Robinhood events fresh; ${observed} mature DEX_PAID observation${observed === 1 ? '' : 's'}, all blocked by safety gate`);
    return;
  }

  await setHealth('robinhood_pipeline', 'healthy', approved > 0
    ? `Robinhood events fresh; ${approved} safety-approved DEX_PAID event${approved === 1 ? '' : 's'}, ${delivered} confirmed deliver${delivered === 1 ? 'y' : 'ies'}`
    : 'Robinhood events fresh; no mature DEX_PAID events in sample');
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
