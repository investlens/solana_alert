import type {
  Investigation,
  RiskLevel,
  SignalTier,
} from '../models/investigation.js';

type BuildInvestigationInput = {
  chain: string;

  token: {
    address: string;
    symbol: string;
  };

  signal: {
    tier: SignalTier;
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
    holderScore: number;
    holderLevel: string;
    holderHasData: boolean;
    bundleScore: number;
    bundleHasData: boolean;
    knownBuyers: number;
  };

  socials: {
    score: number;
    summary: string;
    websiteUrl?: string;
    xUrl?: string;
    telegramUrl?: string;
  };

  links: {
    reportUrl?: string;
    chartUrl: string;
    buyUrl: string;
  };
};

function getSignalTitle(tier: SignalTier): string {
  if (tier === 'P0') return 'PRIORITY REVIEW';
  if (tier === 'P1') return 'QUALIFIED WATCH';
  return 'WATCH';
}

function getTimingLabel(ageMinutes: number): string {
  if (ageMinutes <= 10) return 'EARLY';
  if (ageMinutes <= 30) return 'EARLY-MID';
  if (ageMinutes <= 60) return 'MID';
  return 'LATE';
}

function getAlertStatus(ageMinutes: number): 
Investigation['signal']['status'] {
  if (ageMinutes <= 15) return 'LIVE';
  if (ageMinutes <= 60) return 'MONITORING';
  return 'ARCHIVED';
}

function getBundleLevel(score: number, hasData: boolean): RiskLevel {
  if (!hasData) return 'UNKNOWN';
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

function getBuyerPercentage(buys: number, sells: number): number {
  const total = buys + sells;

  if (total <= 0) return 0;

  return Math.round((buys / total) * 100);
}

function cleanReasons(reasons: string[]): string[] {
  const unique = new Set<string>();

  for (const reason of reasons) {
    const cleaned = String(reason ?? '').trim();

    if (cleaned) {
      unique.add(cleaned);
    }
  }

  return Array.from(unique).slice(0, 3);
}

export function buildInvestigation(
  input: BuildInvestigationInput
): Investigation {
  const address = input.token.address;

  return {
    source: 'DEX_PAID',
    chain: input.chain,
    createdAt: new Date().toISOString(),

    token: {
      address,
      symbol: input.token.symbol,
      shortAddress: `${address.slice(0, 6)}...${address.slice(-6)}`,
    },

    signal: {
      tier: input.signal.tier,
      title: getSignalTitle(input.signal.tier),
      status: getAlertStatus(input.signal.ageMinutes),
      timingLabel: getTimingLabel(input.signal.ageMinutes),
      ageMinutes: input.signal.ageMinutes,
    },

    market: {
      marketCap: input.market.marketCap,
      liquidity: input.market.liquidity,
      volume5m: input.market.volume5m,
      priceUsd: input.market.priceUsd,
    },

    orderflow: {
      buys5m: input.orderflow.buys5m,
      sells5m: input.orderflow.sells5m,
      buyRatio: input.orderflow.buyRatio,
      buyerPercentage: getBuyerPercentage(
        input.orderflow.buys5m,
        input.orderflow.sells5m
      ),
    },

    ai: {
      baseScore: input.ai.baseScore,
      historicalEdge: input.ai.historicalEdge,
      finalScore: input.ai.finalScore,
      confidence: input.ai.confidence,
      decisionConfidence: input.ai.decisionConfidence,
      verdict: input.ai.verdict,
      riskLevel: input.ai.riskLevel,
      reasons: cleanReasons(input.ai.reasons),
    },

    creator: {
      wallet: input.creator.wallet,
      status: input.creator.wallet
        ? input.creator.status || 'LEARNING'
        : 'SCANNING',
      score: input.creator.score,
      launches: input.creator.launches,
      crossed50k: input.creator.crossed50k,
      crossed100k: input.creator.crossed100k,
      crossed250k: input.creator.crossed250k,
      bestMarketCap: input.creator.bestMarketCap,
      verdict: input.creator.wallet
        ? input.creator.verdict || 'Learning profile'
        : 'Creator history is being collected',
    },

    risk: {
      holder: {
        score: input.risk.holderScore,
        level: input.risk.holderHasData
          ? input.risk.holderLevel
          : 'UNKNOWN',
        hasData: input.risk.holderHasData,
      },

      bundle: {
        score: input.risk.bundleScore,
        level: getBundleLevel(
          input.risk.bundleScore,
          input.risk.bundleHasData
        ),
        hasData: input.risk.bundleHasData,
      },

      knownBuyers: input.risk.knownBuyers,
    },

    socials: {
      score: input.socials.score,
      summary: input.socials.summary,
      websiteUrl: input.socials.websiteUrl,
      xUrl: input.socials.xUrl,
      telegramUrl: input.socials.telegramUrl,
    },

    tracking: {
      checkpoints: ['5m', '15m', '30m', '1h', '6h', '24h'],
    },

    links: {
      reportUrl: input.links.reportUrl,
      chartUrl: input.links.chartUrl,
      buyUrl: input.links.buyUrl,
      websiteUrl: input.socials.websiteUrl,
      xUrl: input.socials.xUrl,
      telegramUrl: input.socials.telegramUrl,
    },
  };
}
