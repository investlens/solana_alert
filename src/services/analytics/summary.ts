import { supabase } from "../supabase.js";
import type {
  AlertOutcomeRow,
  AnalyticsDataset,
} from "./types.js";
import {
  average,
  calculateRate,
  normalizeStatus,
  nullableNumber,
  round,
  toNumber,
} from "./utils.js";

function findBiggestWinner(
  outcomes: AlertOutcomeRow[],
): AlertOutcomeRow | null {
  return outcomes.reduce<AlertOutcomeRow | null>(
    (bestRow, currentRow) => {
      if (!bestRow) {
        return currentRow;
      }

      return toNumber(currentRow.roi_peak) >
        toNumber(bestRow.roi_peak)
        ? currentRow
        : bestRow;
    },
    null,
  );
}

export async function refreshSummary(
  dataset: AnalyticsDataset,
): Promise<void> {
  const { outcomes, totalAlerts, alertsToday } = dataset;

  const activeAlerts = outcomes.filter(
    (row) => normalizeStatus(row.status) === "ACTIVE",
  ).length;

  const completedAlerts = outcomes.filter(
    (row) => normalizeStatus(row.status) === "COMPLETED",
  ).length;

  const ruggedAlerts = outcomes.filter(
    (row) => normalizeStatus(row.status) === "RUGGED",
  ).length;

  const peakRois = outcomes.map((row) =>
    toNumber(row.roi_peak),
  );

  const currentRois = outcomes.map((row) =>
    toNumber(row.roi_current),
  );

  const drawdowns = outcomes.map((row) =>
    toNumber(row.max_drawdown),
  );

  const scores = outcomes
    .map((row) => nullableNumber(row.alert_score))
    .filter((score): score is number => score !== null);

  const win10 = peakRois.filter((roi) => roi >= 10).length;
  const win25 = peakRois.filter((roi) => roi >= 25).length;
  const win50 = peakRois.filter((roi) => roi >= 50).length;
  const win100 = peakRois.filter((roi) => roi >= 100).length;

  const biggestWinner = findBiggestWinner(outcomes);

  const summaryRow = {
    id: 1,

    updated_at: new Date().toISOString(),

    total_alerts: totalAlerts,
    active_alerts: activeAlerts,
    completed_alerts: completedAlerts,
    rugged_alerts: ruggedAlerts,

    win_10: win10,
    win_25: win25,
    win_50: win50,
    win_100: win100,

    win_rate: calculateRate(win25, outcomes.length),

    average_current_roi: round(average(currentRois)),
    average_peak_roi: round(average(peakRois)),
    average_drawdown: round(average(drawdowns)),

    biggest_winner_symbol: biggestWinner?.symbol ?? null,

    biggest_winner_roi: biggestWinner
      ? round(toNumber(biggestWinner.roi_peak))
      : 0,

    average_ai_score: round(average(scores)),

    alerts_today: alertsToday,

    average_time_to_10: null,
    average_time_to_25: null,
    average_time_to_50: null,
  };

  const { error } = await supabase
    .from("analytics_summary")
    .upsert(summaryRow, {
      onConflict: "id",
    });

  if (error) {
    throw new Error(
      `[AnalyticsSummary] Failed to update summary: ${error.message}`,
    );
  }

  console.log("[AnalyticsSummary] Updated:", {
    totalAlerts,
    activeAlerts,
    completedAlerts,
    ruggedAlerts,
    win25,
    winRate: calculateRate(win25, outcomes.length),
    averagePeakRoi: round(average(peakRois)),
    alertsToday,
  });
}