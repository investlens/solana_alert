export type AlertOutcomeRow = {
  symbol: string | null;
  roi_current: number | string | null;
  roi_peak: number | string | null;
  max_drawdown: number | string | null;
  alert_score: number | string | null;
  status: string | null;
};

export type AnalyticsDataset = {
  outcomes: AlertOutcomeRow[];
  totalAlerts: number;
  alertsToday: number;
};

export type ScoreBandDefinition = {
  scoreBand: string;
  minScore: number;
  maxScore: number;
};

export type OptimizerCandidateResult = {
  optimizerType: "SCORE_THRESHOLD";
  candidateKey: string;
  scoreThreshold: number;

  sampleSize: number;

  win10: number;
  win25: number;
  win50: number;
  win100: number;

  winRate10: number;
  winRate25: number;
  winRate50: number;
  winRate100: number;

  averagePeakRoi: number;
  medianPeakRoi: number;
  averageDrawdown: number;

  ruggedAlerts: number;
  rugRate: number;

  overallWinRate25: number;
  winRateImprovement: number;
  relativeImprovement: number;

  alertReductionRate: number;
  datasetCoverage: number;

  confidenceScore: number;
  confidenceLabel: "LOW" | "MEDIUM" | "HIGH";

  optimizerScore: number;

  rank: number;
  isRecommended: boolean;
  recommendationReason: string;
};