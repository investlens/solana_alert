import { supabase } from "../supabase.js";
import type {
  AlertOutcomeRow,
  AnalyticsDataset,
} from "./types.js";

const PAGE_SIZE = 1000;

async function fetchAllAlertOutcomes(): Promise<AlertOutcomeRow[]> {
  const allRows: AlertOutcomeRow[] = [];

  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from("alert_outcomes")
      .select(
        `
            symbol,
            roi_current,
            roi_peak,
            max_drawdown,
            alert_score,
            status
        `,
        )
      .range(from, to);

    if (error) {
      throw new Error(
        `[AnalyticsDataLoader] Failed to load alert outcomes: ${error.message}`,
      );
    }

    const rows = (data ?? []) as AlertOutcomeRow[];

    allRows.push(...rows);

    if (rows.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return allRows;
}

async function getTotalAlertCount(): Promise<number> {
  const { count, error } = await supabase
    .from("alerts")
    .select("id", {
      count: "exact",
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
      count: "exact",
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

export async function loadAnalyticsDataset(): Promise<AnalyticsDataset> {
  const [outcomes, totalAlerts, alertsToday] = await Promise.all([
    fetchAllAlertOutcomes(),
    getTotalAlertCount(),
    getAlertsTodayCount(),
  ]);

  console.log("[AnalyticsDataLoader] Dataset loaded:", {
    outcomes: outcomes.length,
    totalAlerts,
    alertsToday,
  });

  return {
    outcomes,
    totalAlerts,
    alertsToday,
  };
}