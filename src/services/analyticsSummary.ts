import {
  refreshAnalyticsEngine,
  startAnalyticsEngine,
} from "./analytics/analyticsEngine.js";

/*
 * Compatibility wrapper.
 *
 * main.ts can continue importing startAnalyticsSummary,
 * so we do not need to change the working startup code.
 */

export async function refreshAnalyticsSummary(): Promise<void> {
  await refreshAnalyticsEngine();
}

export function startAnalyticsSummary(): void {
  const enabled = String(process.env.ANALYTICS_ENGINE_ENABLED ?? 'true').toLowerCase() === 'true';
  if (!enabled) {
    console.log('[AnalyticsEngine] disabled during database recovery.');
    return;
  }
  startAnalyticsEngine();
}
