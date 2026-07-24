import { supabase } from "../supabase.js";
import type {
  AlertOutcomeRow,
  AnalyticsDataset,
  ScoreBandDefinition,
} from "./types.js";
import {
  average,
  calculateRate,
  median,
  normalizeStatus,
  nullableNumber,
  round,
  toNumber,
} from "./utils.js";

const SCORE_BANDS: ScoreBandDefinition[] = [
  {
    scoreBand: "0-59",
    minScore: 0,
    maxScore: 59,
  },
  {
    scoreBand: "60-69",
    minScore: 60,
    maxScore: 69,
  },
  {
    scoreBand: "70-74",
    minScore: 70,
    maxScore: 74,
  },
  {
    scoreBand: "75-79",
    minScore: 75,
    maxScore: 79,
  },
  {
    scoreBand: "80-84",
    minScore: 80,
    maxScore: 84,
  },
  {
    scoreBand: "85-89",
    minScore: 85,
    maxScore: 89,
  },
  {
    scoreBand: "90-94",
    minScore: 90,
    maxScore: 94,
  },
  {
    scoreBand: "95-100",
    minScore: 95,
    maxScore: 100,
  },
];

function getRowsForBand(
  outcomes: AlertOutcomeRow[],
  band: ScoreBandDefinition,
): AlertOutcomeRow[] {
  return outcomes.filter((row) => {
    const score = nullableNumber(row.alert_score);

    if (score === null) {
      return false;
    }

    return (
      score >= band.minScore &&
      score <= band.maxScore
    );
  });
}

export async function refreshScoreBands(
  dataset: AnalyticsDataset,
): Promise<void> {
  const updatedAt = new Date().toISOString();

  const scoreBandRows = SCORE_BANDS.map((band) => {
    const bandOutcomes = getRowsForBand(
      dataset.outcomes,
      band,
    );

    const totalAlerts = bandOutcomes.length;

    const peakRois = bandOutcomes.map((row) =>
      toNumber(row.roi_peak),
    );

    const currentRois = bandOutcomes.map((row) =>
      toNumber(row.roi_current),
    );

    const drawdowns = bandOutcomes.map((row) =>
      toNumber(row.max_drawdown),
    );

    const win10 = peakRois.filter(
      (roi) => roi >= 10,
    ).length;

    const win25 = peakRois.filter(
      (roi) => roi >= 25,
    ).length;

    const win50 = peakRois.filter(
      (roi) => roi >= 50,
    ).length;

    const win100 = peakRois.filter(
      (roi) => roi >= 100,
    ).length;

    const ruggedAlerts = bandOutcomes.filter(
      (row) => normalizeStatus(row.status) === "RUGGED",
    ).length;

    return {
      score_band: band.scoreBand,
      min_score: band.minScore,
      max_score: band.maxScore,

      total_alerts: totalAlerts,

      win_10: win10,
      win_25: win25,
      win_50: win50,
      win_100: win100,

      win_rate_10: calculateRate(win10, totalAlerts),
      win_rate_25: calculateRate(win25, totalAlerts),
      win_rate_50: calculateRate(win50, totalAlerts),
      win_rate_100: calculateRate(
        win100,
        totalAlerts,
      ),

      average_current_roi: round(
        average(currentRois),
      ),

      average_peak_roi: round(
        average(peakRois),
      ),

      median_peak_roi: round(
        median(peakRois),
      ),

      average_drawdown: round(
        average(drawdowns),
      ),

      rugged_alerts: ruggedAlerts,

      rug_rate: calculateRate(
        ruggedAlerts,
        totalAlerts,
      ),

      updated_at: updatedAt,
    };
  });

  const { error } = await supabase
    .from("analytics_score_bands")
    .upsert(scoreBandRows, {
      onConflict: "score_band",
    });

  if (error) {
    throw new Error(
      `[AnalyticsScoreBands] Failed to update score bands: ${error.message}`,
    );
  }

  console.log(
    "[AnalyticsScoreBands] Updated:",
    scoreBandRows.map((row) => ({
      band: row.score_band,
      alerts: row.total_alerts,
      winRate25: row.win_rate_25,
      averagePeakRoi: row.average_peak_roi,
      rugRate: row.rug_rate,
    })),
  );
}