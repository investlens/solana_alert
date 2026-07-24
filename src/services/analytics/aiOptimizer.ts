import { supabase } from "../supabase.js";
import type {
  AlertOutcomeRow,
  AnalyticsDataset,
  OptimizerCandidateResult,
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

const SCORE_THRESHOLDS = [
  60,
  65,
  70,
  72,
  75,
  78,
  80,
  82,
  85,
  90,
] as const;

/*
 * This should match the current production threshold.
 * Later we will read it directly from strategy_settings.
 */
const CURRENT_PRODUCTION_THRESHOLD = 72;

/*
 * Avoid recommendations based on tiny samples.
 * We can make this dynamic later.
 */
const MIN_RECOMMENDATION_SAMPLE = 100;

function hasValidScore(row: AlertOutcomeRow): boolean {
  return nullableNumber(row.alert_score) !== null;
}

function rowsAtOrAboveThreshold(
  outcomes: AlertOutcomeRow[],
  threshold: number,
): AlertOutcomeRow[] {
  return outcomes.filter((row) => {
    const score = nullableNumber(row.alert_score);

    return score !== null && score >= threshold;
  });
}

function calculateConfidenceScore(
  sampleSize: number,
  totalDatasetSize: number,
): number {
  if (sampleSize <= 0 || totalDatasetSize <= 0) {
    return 0;
  }

  /*
   * Sample confidence:
   * 100 samples produces 50 points.
   * 300 samples produces the full 70 points.
   */
  const sampleComponent = Math.min(
    70,
    (sampleSize / 300) * 70,
  );

  /*
   * Coverage contributes up to 30 points.
   * This discourages selecting an extremely narrow threshold.
   */
  const coverageRate = sampleSize / totalDatasetSize;

  const coverageComponent = Math.min(
    30,
    coverageRate * 60,
  );

  return round(sampleComponent + coverageComponent);
}

function getConfidenceLabel(
  confidenceScore: number,
): "LOW" | "MEDIUM" | "HIGH" {
  if (confidenceScore >= 75) {
    return "HIGH";
  }

  if (confidenceScore >= 50) {
    return "MEDIUM";
  }

  return "LOW";
}

function calculateOptimizerScore(input: {
  winRate25: number;
  winRate50: number;
  averagePeakRoi: number;
  medianPeakRoi: number;
  rugRate: number;
  confidenceScore: number;
}): number {
  /*
   * Main objective: improve repeatable +25% outcomes.
   *
   * Median receives meaningful weight because one huge winner
   * should not make a weak strategy look strong.
   *
   * Rug rate is penalized heavily.
   */
  const rawScore =
    input.winRate25 * 0.4 +
    input.winRate50 * 0.15 +
    Math.max(input.averagePeakRoi, 0) * 0.1 +
    Math.max(input.medianPeakRoi, 0) * 0.15 +
    input.confidenceScore * 0.2 -
    input.rugRate * 0.75;

  return round(Math.max(rawScore, 0));
}

function buildCandidateResult(
  outcomes: AlertOutcomeRow[],
  allScoredOutcomes: AlertOutcomeRow[],
  threshold: number,
  overallWinRate25: number,
): OptimizerCandidateResult {
  const candidateRows = rowsAtOrAboveThreshold(
    outcomes,
    threshold,
  );

  const sampleSize = candidateRows.length;
  const totalDatasetSize = allScoredOutcomes.length;

  const peakRois = candidateRows.map((row) =>
    toNumber(row.roi_peak),
  );

  const drawdowns = candidateRows.map((row) =>
    toNumber(row.max_drawdown),
  );

  const win10 = peakRois.filter((roi) => roi >= 10).length;
  const win25 = peakRois.filter((roi) => roi >= 25).length;
  const win50 = peakRois.filter((roi) => roi >= 50).length;
  const win100 = peakRois.filter((roi) => roi >= 100).length;

  const winRate10 = calculateRate(win10, sampleSize);
  const winRate25 = calculateRate(win25, sampleSize);
  const winRate50 = calculateRate(win50, sampleSize);
  const winRate100 = calculateRate(win100, sampleSize);

  const averagePeakRoi = round(average(peakRois));
  const medianPeakRoi = round(median(peakRois));
  const averageDrawdown = round(average(drawdowns));

  const ruggedAlerts = candidateRows.filter(
    (row) => normalizeStatus(row.status) === "RUGGED",
  ).length;

  const rugRate = calculateRate(
    ruggedAlerts,
    sampleSize,
  );

  const winRateImprovement = round(
    winRate25 - overallWinRate25,
  );

  const relativeImprovement =
    overallWinRate25 > 0
      ? round(
          (winRateImprovement / overallWinRate25) * 100,
        )
      : 0;

  const datasetCoverage = calculateRate(
    sampleSize,
    totalDatasetSize,
  );

  const alertReductionRate = round(
    100 - datasetCoverage,
  );

  const confidenceScore = calculateConfidenceScore(
    sampleSize,
    totalDatasetSize,
  );

  const confidenceLabel =
    getConfidenceLabel(confidenceScore);

  const optimizerScore = calculateOptimizerScore({
    winRate25,
    winRate50,
    averagePeakRoi,
    medianPeakRoi,
    rugRate,
    confidenceScore,
  });

  return {
    optimizerType: "SCORE_THRESHOLD",
    candidateKey: `SCORE_GTE_${threshold}`,
    scoreThreshold: threshold,

    sampleSize,

    win10,
    win25,
    win50,
    win100,

    winRate10,
    winRate25,
    winRate50,
    winRate100,

    averagePeakRoi,
    medianPeakRoi,
    averageDrawdown,

    ruggedAlerts,
    rugRate,

    overallWinRate25,
    winRateImprovement,
    relativeImprovement,

    alertReductionRate,
    datasetCoverage,

    confidenceScore,
    confidenceLabel,

    optimizerScore,

    rank: 0,
    isRecommended: false,
    recommendationReason: "",
  };
}

function rankCandidates(
  candidates: OptimizerCandidateResult[],
): OptimizerCandidateResult[] {
  const sortedCandidates = [...candidates].sort(
    (first, second) => {
      /*
       * Qualified samples rank before undersized samples.
       */
      const firstQualified =
        first.sampleSize >= MIN_RECOMMENDATION_SAMPLE;

      const secondQualified =
        second.sampleSize >= MIN_RECOMMENDATION_SAMPLE;

      if (firstQualified !== secondQualified) {
        return firstQualified ? -1 : 1;
      }

      return (
        second.optimizerScore -
        first.optimizerScore
      );
    },
  );

  return sortedCandidates.map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
  }));
}

function chooseRecommendation(
  candidates: OptimizerCandidateResult[],
): OptimizerCandidateResult | null {
  const qualifiedCandidates = candidates.filter(
    (candidate) =>
      candidate.sampleSize >= MIN_RECOMMENDATION_SAMPLE &&
      candidate.winRateImprovement > 0 &&
      candidate.confidenceLabel !== "LOW",
  );

  return qualifiedCandidates[0] ?? null;
}

function getCurrentCandidate(
  candidates: OptimizerCandidateResult[],
): OptimizerCandidateResult | null {
  return (
    candidates.find(
      (candidate) =>
        candidate.scoreThreshold ===
        CURRENT_PRODUCTION_THRESHOLD,
    ) ?? null
  );
}

function buildRecommendationReason(
  recommended: OptimizerCandidateResult,
  current: OptimizerCandidateResult | null,
): string {
  if (!current) {
    return [
      `Score >= ${recommended.scoreThreshold}`,
      `produced a ${recommended.winRate25}% +25% win rate`,
      `across ${recommended.sampleSize} historical outcomes`,
      `with ${recommended.confidenceLabel.toLowerCase()} confidence.`,
    ].join(" ");
  }

  return [
    `Raise the shadow score threshold from`,
    `${current.scoreThreshold} to`,
    `${recommended.scoreThreshold}.`,
    `Historical +25% win rate changes from`,
    `${current.winRate25}% to`,
    `${recommended.winRate25}%,`,
    `while reducing alert volume by`,
    `${recommended.alertReductionRate}%.`,
    `This recommendation is analysis-only and does not alter production settings.`,
  ].join(" ");
}

async function saveCandidateResults(
  candidates: OptimizerCandidateResult[],
): Promise<void> {
  const updatedAt = new Date().toISOString();

  const databaseRows = candidates.map((candidate) => ({
    optimizer_type: candidate.optimizerType,
    candidate_key: candidate.candidateKey,

    score_threshold: candidate.scoreThreshold,

    sample_size: candidate.sampleSize,

    win_10: candidate.win10,
    win_25: candidate.win25,
    win_50: candidate.win50,
    win_100: candidate.win100,

    win_rate_10: candidate.winRate10,
    win_rate_25: candidate.winRate25,
    win_rate_50: candidate.winRate50,
    win_rate_100: candidate.winRate100,

    average_peak_roi: candidate.averagePeakRoi,
    median_peak_roi: candidate.medianPeakRoi,
    average_drawdown: candidate.averageDrawdown,

    rugged_alerts: candidate.ruggedAlerts,
    rug_rate: candidate.rugRate,

    overall_win_rate_25: candidate.overallWinRate25,
    win_rate_improvement: candidate.winRateImprovement,
    relative_improvement: candidate.relativeImprovement,

    alert_reduction_rate: candidate.alertReductionRate,
    dataset_coverage: candidate.datasetCoverage,

    confidence_score: candidate.confidenceScore,
    confidence_label: candidate.confidenceLabel,

    optimizer_score: candidate.optimizerScore,
    rank: candidate.rank,

    is_recommended: candidate.isRecommended,
    recommendation_reason:
      candidate.recommendationReason,

    updated_at: updatedAt,
  }));

  const { error } = await supabase
    .from("analytics_optimizer_results")
    .upsert(databaseRows, {
      onConflict: "optimizer_type,candidate_key",
    });

  if (error) {
    throw new Error(
      `[AIOptimizer] Failed to save candidate results: ${error.message}`,
    );
  }
}

async function saveRecommendation(
  recommended: OptimizerCandidateResult | null,
  current: OptimizerCandidateResult | null,
): Promise<void> {
  const recommendationReason = recommended
    ? buildRecommendationReason(recommended, current)
    : "No candidate currently meets the minimum sample, improvement, and confidence requirements.";

  const recommendationRow = {
    id: 1,

    optimizer_type: "SCORE_THRESHOLD",

    current_threshold:
      current?.scoreThreshold ??
      CURRENT_PRODUCTION_THRESHOLD,

    recommended_threshold:
      recommended?.scoreThreshold ?? null,

    current_win_rate_25:
      current?.winRate25 ?? 0,

    recommended_win_rate_25:
      recommended?.winRate25 ?? 0,

    absolute_improvement:
      recommended && current
        ? round(
            recommended.winRate25 -
              current.winRate25,
          )
        : 0,

    relative_improvement:
      recommended && current && current.winRate25 > 0
        ? round(
            ((recommended.winRate25 -
              current.winRate25) /
              current.winRate25) *
              100,
          )
        : 0,

    current_sample_size:
      current?.sampleSize ?? 0,

    recommended_sample_size:
      recommended?.sampleSize ?? 0,

    alert_reduction_rate:
      recommended?.alertReductionRate ?? 0,

    current_average_peak_roi:
      current?.averagePeakRoi ?? 0,

    recommended_average_peak_roi:
      recommended?.averagePeakRoi ?? 0,

    current_rug_rate:
      current?.rugRate ?? 0,

    recommended_rug_rate:
      recommended?.rugRate ?? 0,

    confidence_score:
      recommended?.confidenceScore ?? 0,

    confidence_label:
      recommended?.confidenceLabel ?? "LOW",

    recommendation_status: "SHADOW",

    recommendation_reason: recommendationReason,

    generated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("analytics_optimizer_recommendation")
    .upsert(recommendationRow, {
      onConflict: "id",
    });

  if (error) {
    throw new Error(
      `[AIOptimizer] Failed to save recommendation: ${error.message}`,
    );
  }
}

export async function refreshAiOptimizer(
  dataset: AnalyticsDataset,
): Promise<void> {
  const allScoredOutcomes = dataset.outcomes.filter(
    hasValidScore,
  );

  if (allScoredOutcomes.length === 0) {
    console.log(
      "[AIOptimizer] No scored outcomes available.",
    );

    return;
  }

  const allPeakRois = allScoredOutcomes.map((row) =>
    toNumber(row.roi_peak),
  );

  const overallWin25 = allPeakRois.filter(
    (roi) => roi >= 25,
  ).length;

  const overallWinRate25 = calculateRate(
    overallWin25,
    allScoredOutcomes.length,
  );

  const unrankedCandidates = SCORE_THRESHOLDS.map(
    (threshold) =>
      buildCandidateResult(
        allScoredOutcomes,
        allScoredOutcomes,
        threshold,
        overallWinRate25,
      ),
  );

  const rankedCandidates = rankCandidates(
    unrankedCandidates,
  );

  const recommendation = chooseRecommendation(
    rankedCandidates,
  );

  const currentCandidate = getCurrentCandidate(
    rankedCandidates,
  );

  const finalCandidates = rankedCandidates.map(
    (candidate) => {
      const isRecommended =
        recommendation?.candidateKey ===
        candidate.candidateKey;

      return {
        ...candidate,
        isRecommended,
        recommendationReason: isRecommended
          ? buildRecommendationReason(
              candidate,
              currentCandidate,
            )
          : "",
      };
    },
  );

  await saveCandidateResults(finalCandidates);

  await saveRecommendation(
    recommendation,
    currentCandidate,
  );

  console.log("[AIOptimizer] Updated:", {
    overallWinRate25,
    currentThreshold:
      currentCandidate?.scoreThreshold ??
      CURRENT_PRODUCTION_THRESHOLD,
    currentWinRate25:
      currentCandidate?.winRate25 ?? 0,
    recommendedThreshold:
      recommendation?.scoreThreshold ?? null,
    recommendedWinRate25:
      recommendation?.winRate25 ?? null,
    recommendedSampleSize:
      recommendation?.sampleSize ?? 0,
    confidence:
      recommendation?.confidenceLabel ?? "LOW",
    status: "SHADOW",
  });

  console.table(
    finalCandidates.map((candidate) => ({
      rank: candidate.rank,
      threshold: candidate.scoreThreshold,
      sample: candidate.sampleSize,
      winRate25: candidate.winRate25,
      avgPeak: candidate.averagePeakRoi,
      medianPeak: candidate.medianPeakRoi,
      rugRate: candidate.rugRate,
      reduction: candidate.alertReductionRate,
      confidence: candidate.confidenceLabel,
      score: candidate.optimizerScore,
      recommended: candidate.isRecommended,
    })),
  );
}