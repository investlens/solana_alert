import { refreshAiOptimizer } from "./aiOptimizer.js";
import { loadAnalyticsDataset } from "./dataLoader.js";
import { refreshScoreBands } from "./scoreBands.js";
import { refreshSummary } from "./summary.js";

const ANALYTICS_INTERVAL_MS = 60 * 60_000;

let analyticsCycleRunning = false;
let analyticsInterval: ReturnType<typeof setInterval> | null = null;

export async function refreshAnalyticsEngine(): Promise<void> {
  if (analyticsCycleRunning) {
    console.log("[AnalyticsEngine] Previous cycle is still running. Skipping.");
    return;
  }

  analyticsCycleRunning = true;
  const startedAt = Date.now();

  try {
    console.log("[AnalyticsEngine] Starting refresh...");
    const dataset = await loadAnalyticsDataset();

    if (!dataset) {
      console.log("[AnalyticsEngine] Skipped while database governor is protecting critical work.");
      return;
    }

    await refreshSummary(dataset);
    await refreshScoreBands(dataset);
    await refreshAiOptimizer(dataset);

    const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(2);
    console.log(`[AnalyticsEngine] Refresh completed in ${durationSeconds}s.`);
  } catch (error) {
    console.error("[AnalyticsEngine] Refresh failed:", error);
  } finally {
    analyticsCycleRunning = false;
  }
}

export function startAnalyticsEngine(): void {
  if (analyticsInterval) {
    console.log("[AnalyticsEngine] Already started. Ignoring duplicate start.");
    return;
  }

  console.log(`[AnalyticsEngine] Started. Interval: ${ANALYTICS_INTERVAL_MS / 1000} seconds.`);

  analyticsInterval = setInterval(() => {
    void refreshAnalyticsEngine();
  }, ANALYTICS_INTERVAL_MS);
}
