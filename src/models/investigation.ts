export type SignalTier = 'P0' | 'P1' | 'P2';

export type AlertStatus =
  | 'LIVE'
  | 'MONITORING'
  | 'INVALIDATED'
  | 'ARCHIVED';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';

export interface InvestigationLinks {
  reportUrl?: string;
  chartUrl: string;
  buyUrl: string;
  websiteUrl?: string;
  xUrl?: string;
  telegramUrl?: string;
}

export interface Investigation {
  source: 'DEX_PAID';
  chain: string;
  createdAt: string;

  token: {
    address: string;
    shortAddress: string;
    symbol: string;
  };

  signal: {
    tier: SignalTier;
    title: string;
    status: AlertStatus;
    timingLabel: string;
    ageMinutes: number;
  };

  market: {
    marketCap: number | null;
    liquidity: number;
    volume5m: number;
    priceUsd: number | null;
  };

  orderflow: {
    buys5m: number;
    sells5m: number;
    buyRatio: number;
    buyerPercentage: number;
  };

  ai: {
    baseScore: number;
    historicalEdge: number;
    finalScore: number;
    confidence: number;
    decisionConfidence: number;
    verdict: string;
    riskLevel: string;
    reasons: string[];
  };

  creator: {
    wallet: string | null;
    status: string;
    score: number;
    launches: number;
    crossed50k: number;
    crossed100k: number;
    crossed250k: number;
    bestMarketCap: number;
    verdict: string;
  };

  risk: {
    holder: {
      score: number;
      level: string;
      hasData: boolean;
    };

    bundle: {
      score: number;
      level: RiskLevel;
      hasData: boolean;
    };

    knownBuyers: number;
  };

  socials: {
    score: number;
    summary: string;
    websiteUrl?: string;
    xUrl?: string;
    telegramUrl?: string;
  };

  tracking: {
    checkpoints: Array<'5m' | '15m' | '30m' | '1h' | '6h' | '24h'>;
  };

  links: InvestigationLinks;
}
