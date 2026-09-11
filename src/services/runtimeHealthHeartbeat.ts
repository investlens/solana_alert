import { supabase } from './supabase.js';

const COMPONENTS = [
  'ai_decision_engine',
  'creator_intel',
  'dexscreener',
  'premium_alerts',
] as const;

async function heartbeat(): Promise<void> {
  const now = new Date().toISOString();

  for (const component of COMPONENTS) {
    const { error } = await supabase
      .from('system_health')
      .update({
        status: 'healthy',
        last_heartbeat: now,
      })
      .eq('component', component);

    if (error) {
      console.warn('[SystemHealth] heartbeat failed', {
        component,
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
