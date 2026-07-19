export type Chain =
  | 'solana'
  | 'ethereum'
  | 'base'
  | 'robinhood'
  | 'sui'
  | 'bsc'
  | 'unknown';

export type OpportunityStatus =
  | 'NEW'
  | 'WATCHING'
  | 'APPROVED'
  | 'EXECUTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'REVIEWED';

export type OpportunityType =
  | 'TOKEN_PREDEX'
  | 'TOKEN_CREATOR'
  | 'TOKEN_WALLET'
  | 'DEX_CONFIRMATION'
  | 'NFT_MISPRICE'
  | 'NFT_OFFER_ARBITRAGE'
  | 'CEX_DEX_ARB'
  | 'PREDICTION_MARKET'
  | 'NEWS_CATALYST';

export type RiskLevel =
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'UNKNOWN';

export type ScannerStatus =
  | 'RUNNING'
  | 'DEGRADED'
  | 'STOPPED'
  | 'UNKNOWN';

export type ModuleStatus =
  | 'healthy'
  | 'degraded'
  | 'offline';

export type DashboardStat = {
  id: string;
  label: string;
  value: string | number;
  helperText?: string;
  trend?: number | null;
  status?: ModuleStatus;
};

export type DashboardStatsResponse = {
  scannerStatus: ScannerStatus;
  tokensTracked: number;
  timelineEvents: number;
  alertsToday: number;
  buysToday: number;
  moonshots: number;
  completedOutcomes: number;
  winnerRate: number;
  averagePeakReturn: number;
  latestBuy: {
    token: string;
    symbol: string;
    marketCap: number | null;
    score: number | null;
    createdAt: string | null;
  } | null;
};

export type LiveOpportunity = {
  id: string | number;
  opportunityType: OpportunityType;
  assetId: string;
  token: string;
  symbol: string;
  title: string;
  chain: Chain;
  sourceAgent: string;
  confidence: number;
  riskScore: number;
  riskLevel: RiskLevel;
  status: OpportunityStatus;
  expectedProfit: number | null;
  expectedProfitPercent: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  marketCap: number | null;
  liquidity: number | null;
  createdAt: string;
  updatedAt: string | null;
  reportUrl: string;
};

export type OpportunitiesResponse = {
  items: LiveOpportunity[];
  total: number;
  generatedAt: string;
};

export type BestCall = {
  id: string;
  token: string;
  symbol: string;
  title: string;
  chain: Chain;
  score: number | null;
  conviction: string | null;
  roiNow: number | null;
  roiHigh: number;
  alertPrice: number | null;
  currentPrice: number | null;
  highAfterAlert: number | null;
  createdAt: string;
  reportUrl: string;
};

export type BestCallsResponse = {
  items: BestCall[];
  total: number;
  generatedAt: string;
};

export type ActivityType =
  | 'ALERT_CREATED'
  | 'CONFIDENCE_UPDATED'
  | 'CREATOR_UPDATED'
  | 'WALLET_ACTIVITY'
  | 'MILESTONE_REACHED'
  | 'OUTCOME_UPDATED'
  | 'SYSTEM'
  | 'UNKNOWN';

export type ActivityTone =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral';

export type AIActivityItem = {
  id: string | number;
  type: ActivityType;
  tone: ActivityTone;
  token: string | null;
  symbol: string | null;
  title: string;
  description: string | null;
  marketCap: number | null;
  alphaScore: number | null;
  createdAt: string;
  reportUrl: string | null;
};

export type ActivityResponse = {
  items: AIActivityItem[];
  total: number;
  generatedAt: string;
};

export type AlphaMemoryMetrics = {
  tokensTracked: number;
  timelineEvents: number;
  reached50k: number;
  reached100k: number;
  reached250k: number;
  reached500k: number;
  reached1m: number;
  creatorProfiles: number;
  walletProfiles: number;
  learnedPatterns: number;
};

export type MemoryResponse = {
  metrics: AlphaMemoryMetrics;
  generatedAt: string;
};

export type DashboardModuleState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

export type ApiSuccess<T> = {
  success: true;
  data: T;
};

export type ApiFailure = {
  success: false;
  error: string;
};

export type ApiResponse<T> =
  | ApiSuccess<T>
  | ApiFailure;