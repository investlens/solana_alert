import { runDatabaseWork } from "../databaseLoadGovernor.js";
import { supabase } from "../supabase.js";
import type {
  AlertOutcomeRow,
  AnalyticsDataset,
} from "./types.js";

const ANALYTICS_OUTCOME_LIMIT = 5_000;

async function fetchBoundedAlertOutcomes(): Promise<AlertOutcomeRow[]> {
  const { data, error } = await supabase
    .from("alert_outcomes")
    .select(`
      symbol,
      roi_current,
      roi_peak,
      max_drawdown,
      alert_score,
      status
    `)
    .order("updated_at", { ascending: false })
    .limit(ANALYTICS_OUTCOME_LIMIT);

  if (error) {
    throw new Error(
      `[AnalyticsDataLoader] Failed to load alert outcomes: ${error.message}`,
    );
  }

  return (data ?? []) as AlertOutcomeRow[];
}

async function getApproximateAlertCount(): Promise<number> {
  const { count, error } = await supabase
    .from("alerts")
    .select("id", {
      count: "planned",
      head: true,
    });

  if (error) {
    throw new Error(
      `[AnalyticsDataLoader] Failed to count alerts: ${error.message}`,
    );
  }

  return count ?? 0;
}

async function getAlertsTodayCount(): Promise<number> {
  const startOfTodayUtc = new Date();
  startOfTodayUtc.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from("alerts")
    .select("id", {
      count: "planned",
      head: true,
    })
    .gte("alerted_at", startOfTodayUtc.toISOString());

  if (error) {
    throw new Error(
      `[AnalyticsDataLoader] Failed to count today's alerts: ${error.message}`,
    );
  }

  return count ?? 0;
}

async function loadAnalyticsDatasetOnce(): Promise<AnalyticsDataset> {
  const [outcomes, totalAlerts, alertsToday] = await Promise.all([
    fetchBoundedAlertOutcomes(),
    getApproximateAlertCount(),
    getAlertsTodayCount(),
  ]);

  console.log("[AnalyticsDataLoader] Dataset loaded:", {
    outcomes: outcomes.length,
    totalAlerts,
    alertsToday,
    bounded: outcomes.length >= ANALYTICS_OUTCOME_LIMIT,
  });

  return {
    outcomes,
    totalAlerts,
    alertsToday,
  };
}

export async function loadAnalyticsDataset(): Promise<AnalyticsDataset | null> {
  return runDatabaseWork("BACKGROUND", loadAnalyticsDatasetOnce);
}
