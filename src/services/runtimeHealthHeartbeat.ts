import { supabase } from './supabase.js';

const SERVICES = [
  'telegram_bot',
  'dexscreener',
  'wallet_watcher',
  'creator_intel',
  'ai_decision_engine',
  'premium_alerts',
] as const;

async function heartbeat(): Promise<void> {
  const now = new Date().toISOString();

  for (const service of SERVICES) {
    const { error } = await supabase
      .from('system_health')
      .update({
        status: 'healthy',
        message: 'Runtime heartbeat active',
        last_seen_at: now,
        updated_at: now,
      })
      .eq('service', service);

    if (error) {
      console.warn('[SystemHealth] heartbeat failed', {
        service,
        reason: error.message,
      });
    }
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
