import { runDatabaseWork } from './databaseLoadGovernor.js';

export type LinkageDependencies = {
 now: () => number;
 reconcile: () => PromiseLike<unknown>;
};
// One small batch per five minutes, outside alert fan-out and checkpoint writes.
// Census-only SQL verification: no RPC scanner, wallet guessing or alert replay.
export function createDeveloperOutcomeReconciler(deps: LinkageDependencies) {
 let running = false; let nextAt = 0;
 return async (): Promise<void> => {
  if (running || deps.now() < nextAt) return;
  running = true; nextAt = deps.now() + 5 * 60000;
  try {
   const result = await runDatabaseWork('BACKGROUND', deps.reconcile);
   if (result !== null) console.log('[DeveloperOutcomes] RECONCILED', result);
  } catch {
   console.warn('[DeveloperOutcomes] attribution unavailable; retry in five minutes');
  } finally { running = false; }
 };
}

export const reconcileDeveloperOutcomeLinks = createDeveloperOutcomeReconciler({
 now: Date.now,
 reconcile: async () => {
  const { supabase } = await import('./supabase.js');
  const { data, error } = await supabase.rpc('alpha_reconcile_compact_creators', { p_limit: 25 })
   .abortSignal(AbortSignal.timeout(2000));
  if (error) throw error;
  return data;
 },
});
