import { supabase } from './supabase.js';

let lastRetentionAt = Date.now();
const RETENTION_INTERVAL_MS = 6 * 60 * 60_000;

async function heartbeat(): Promise<void> {
  const now = new Date().toISOString();

  // A process heartbeat proves liveness only, not provider or feature health.
  const { error } = await supabase
    .from('system_health')
    .upsert({
      service: `runtime_${process.env.RAILWAY_SERVICE_NAME ?? 'telegram_bot'}`,
      status: 'healthy',
      message: 'Process alive; feature and delivery health assessed separately',
      metadata: { scope: 'PROCESS_LIVENESS_ONLY' },
      last_seen_at: now,
      updated_at: now,
    }, { onConflict: 'service' });

  if (!error && Date.now() - lastRetentionAt >= RETENTION_INTERVAL_MS) {
    // One bounded maintenance request per six hours; no new polling loop.
    lastRetentionAt = Date.now();
    const result = await supabase.rpc('alphaos_trim_stale_agent_payloads');
    if (result.error) console.warn('[Retention] raw input cleanup unavailable', result.error.message);
    else console.log('[Retention] obsolete input payloads trimmed', { rows: result.data, maxRows: 250 });
  }

  if (error) {
    console.warn('[SystemHealth] heartbeat failed', {
      scope: 'process',
      reason: error.message,
    });
  }
}

let started = false;

export function startRuntimeHealthHeartbeat(): void {
  if (started) return;
  started = true;

  const run = () => void heartbeat().catch((error) => {
    console.warn('[SystemHealth] heartbeat cycle failed', {
      reason: error instanceof Error ? error.message : String(error),
    });
  });

  run();
  setInterval(run, 60_000);
}
