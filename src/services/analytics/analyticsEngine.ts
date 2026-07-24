import { refreshAiOptimizer } from "./aiOptimizer.js";
import { loadAnalyticsDataset } from "./dataLoader.js";
import { refreshScoreBands } from "./scoreBands.js";
import { refreshSummary } from "./summary.js";


const ANALYTICS_INTERVAL_MS = 60_000;

let analyticsCycleRunning = false;
let analyticsInterval:
  | ReturnType<typeof setInterval>
  | null = null;

export async function refreshAnalyticsEngine(): Promise<void> {
  if (analyticsCycleRunning) {
    console.log(
      "[AnalyticsEngine] Previous cycle is still running. Skipping.",
    );

    return;
  }

  analyticsCycleRunning = true;

  const startedAt = Date.now();

  try {
    console.log("[AnalyticsEngine] Starting refresh...");

    /*
     * Read the database once.
     * Every analytics module receives the same dataset.
     */
    const dataset = await loadAnalyticsDataset();

    await refreshSummary(dataset);
    await refreshScoreBands(dataset);
    await refreshAiOptimizer(dataset);

    const durationSeconds = (
      (Date.now() - startedAt) /
      1000
    ).toFixed(2);

    console.log(
      `[AnalyticsEngine] Refresh completed in ${durationSeconds}s.`,
    );
  } catch (error) {
    console.error(
      "[AnalyticsEngine] Refresh failed:",
      error,
    );
  } finally {
    analyticsCycleRunning = false;
  }
}

export function startAnalyticsEngine(): void {
  if (analyticsInterval) {
    console.log(
      "[AnalyticsEngine] Already started. Ignoring duplicate start.",
    );

    return;
  }

  console.log(
    `[AnalyticsEngine] Started. Interval: ${
      ANALYTICS_INTERVAL_MS / 1000
    } seconds.`,
  );

  void refreshAnalyticsEngine();

  analyticsInterval = setInterval(() => {
    void refreshAnalyticsEngine();
  }, ANALYTICS_INTERVAL_MS);
}