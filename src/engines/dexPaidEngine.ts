import { config } from '../config.js';
import { sendTelegram } from '../services/telegram.js';
import {
  getDeliverableUsers,
  markTelegramUserBlocked,
} from '../core/delivery.js';
import { getConsolidationRisk } from '../scoring/consolidationRisk.js';
import { addAlphaSignal } from './alphaFeed.js';
import { recordDecisionForToken } from '../agents/decisionAgent.js';
import { canSendTokenAlert } from '../core/alertDeduper.js';
import { calculateConfidence } from '../agents/confidenceAgent.js';
import { upsertTokenMemory } from '../memory/tokenMemory.js';
import { buildInvestigation } from '../builders/investigationBuilder.js';
import { renderTelegramInvestigation } from '../renderers/telegramRenderer.js';
import { buildTelegramButtons } from '../ui/telegramButtons.js';
import type { Investigation } from '../models/investigation.js';
import {
  getCreatorIntelligenceV2,
  getCreatorWalletForTokenV2,
} from '../profiles/creatorIntelligenceV2.js';
import { getCreatorWalletForToken } from '../profiles/tokenCreatorLookup.js';
import {
  creatorTrustLabel,
} from '../core/creatorReputation.js';
import { getHolderRisk } from '../scoring/holderRisk.js';
import {
  startAdminAutoTrade,
  isAutoTradePaused,
} from '../core/autoTradeManager.js';
import { getTokenBuyers } from '../core/walletWatcher.js';
import {
  enrichToken,
  fetchBoostMap,
  fetchLatestProfiles,
  fetchTakeoverSet,
} from '../services/dexscreener.js';

const seen = new Set<string>();

type Candidate = {
  token: string;
  symbol: string;
  liquidity: number;
  volume5m: number;
  buys5m: number;
  sells5m: number;
  ageMin: number;
  priceUsd: number | null;
  marketCap: number | null;
  dexUrl: string;
  buyUrl: string;
  socialScore: number;
  socialSummary: string;
  hasStrongSocials: boolean;
  websiteUrl?: string;
  xUrl?: string;
  telegramUrl?: string;
  earlyBuyers: string[];
  creatorWallet: string | null;
};

function escapeHtml(value: unknown) {
  return String(value ?? '-')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtUsd(value: number | null) {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function fmtPrice(value: number | null) {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  if (value < 0.000001) return `$${value.toExponential(2)}`;
  if (value < 0.01) return `$${value.toFixed(8)}`;
  return `$${value.toFixed(6)}`;
}

function buyRatio(c: Candidate) {
  return c.sells5m <= 0 ? c.buys5m : c.buys5m / c.sells5m;
}

function sellBuyRatio(c: Candidate) {
  return c.buys5m <= 0 ? 999 : c.sells5m / c.buys5m;
}

function getSocialQuality(profile: any) {
  const links = Array.isArray(profile.links) ? profile.links : [];

  let websiteUrl: string | undefined;
  let xUrl: string | undefined;
  let telegramUrl: string | undefined;

  for (const link of links) {
    const url = String(link?.url ?? '').trim();
    const type = String(link?.type ?? '').toLowerCase();
    const label = String(link?.label ?? '').toLowerCase();
    const combined = `${type} ${label} ${url.toLowerCase()}`;

    if (!url.startsWith('http')) continue;

    if (
      !xUrl &&
      (
        combined.includes('twitter') ||
        combined.includes('x.com') ||
        url.toLowerCase().includes('twitter.com')
      )
    ) {
      xUrl = url;
      continue;
    }

    if (
      !telegramUrl &&
      (
        combined.includes('telegram') ||
        url.toLowerCase().includes('t.me/')
      )
    ) {
      telegramUrl = url;
      continue;
    }

    if (
      !websiteUrl &&
      !url.toLowerCase().includes('dexscreener') &&
      !url.toLowerCase().includes('twitter.com') &&
      !url.toLowerCase().includes('x.com') &&
      !url.toLowerCase().includes('t.me/')
    ) {
      websiteUrl = url;
    }
  }

  let score = 0;
  const parts: string[] = [];

  if (xUrl) {
    score += 25;
    parts.push('X');
  }

  if (telegramUrl) {
    score += 20;
    parts.push('Telegram');
  }

  if (websiteUrl) {
    score += 10;
    parts.push('Website');
  }

  return {
    socialScore: score,
    socialSummary: parts.length
      ? parts.join(' + ')
      : 'No verified socials',
    hasStrongSocials: score >= 25,
    websiteUrl,
    xUrl,
    telegramUrl,
  };
}

function looksBadSymbol(symbol: string) {
  const s = symbol.toUpperCase();

  const banned = [
    'ASS',
    'DILDO',
    'FUCK',
    'SHIT',
    'RUG',
    'SCAM',
    'DUMP',
    'JEET',
    'BUTT',
    'INCEL',
  ];

  return banned.some((x) => s.includes(x));
}

function momentumScore(c: Candidate) {
  let score = 0;

  if (c.volume5m >= 5_000) score += 10;
  if (c.volume5m >= 12_000) score += 10;
  if (c.volume5m >= 30_000) score += 10;

  if (c.buys5m >= 50) score += 8;
  if (c.buys5m >= 150) score += 8;

  return Math.min(score, 30);
}

function liquidityScore(c: Candidate) {
  let score = 0;

  if (c.liquidity >= 8_000) score += 10;
  if (c.liquidity >= 15_000) score += 5;
  if (c.liquidity >= 25_000) score += 5;

  return Math.min(score, 20);
}

function orderflowScore(c: Candidate) {
  let score = 0;
  const ratio = buyRatio(c);

  if (ratio >= 1.3) score += 8;
  if (ratio >= 1.6) score += 9;
  if (ratio >= 2.2) score += 8;

  return Math.min(score, 25);
}

function freshnessScore(c: Candidate) {
  if (c.ageMin <= 10) return 15;
  if (c.ageMin <= 30) return 12;
  if (c.ageMin <= 60) return 8;
  if (c.ageMin <= 90) return 5;
  return 0;
}

function riskPenalty(c: Candidate) {
  let penalty = 0;

  if (looksBadSymbol(c.symbol)) penalty += 30;
  if (!c.hasStrongSocials) penalty += 20;
  if (c.volume5m < 5_000) penalty += 15;
  if (c.buys5m <= c.sells5m) penalty += 15;
  if (sellBuyRatio(c) > 0.7) penalty += 15;
  if (c.ageMin > 90) penalty += 15;
  if (c.liquidity < 8_000) penalty += 20;
  if (!c.marketCap || c.marketCap >= 100_000) penalty += 10;

  return penalty;
}

function alphaScore(c: Candidate) {
  const raw =
    momentumScore(c) +
    liquidityScore(c) +
    orderflowScore(c) +
    freshnessScore(c) +
    Math.min(10, Math.floor(c.socialScore / 5));

  return Math.max(0, Math.min(100, raw - riskPenalty(c)));
}

function conviction(score: number) {
  if (score >= 85) return 'PRIORITY REVIEW';
  if (score >= 75) return 'QUALIFIED REVIEW';
  if (score >= 70) return 'WATCH';
  return 'IGNORE';
}

function qualifies(c: Candidate) {
  if (looksBadSymbol(c.symbol)) return false;
  if (!c.hasStrongSocials) return false;

  // Must be early, not already mature
  if (!c.marketCap || c.marketCap >= 120_000) return false;
  if (c.ageMin > 60) return false;

  // Needs real liquidity, but not too late
  if (c.liquidity < 8_000) return false;
  if (c.liquidity > 45_000) return false;

  // Needs strong fresh demand
  if (c.volume5m < 7_500) return false;
  if (c.buys5m < 40) return false;

  // Sell pressure must be very low
  if (sellBuyRatio(c) > 0.6) return false;
  if (buyRatio(c) < 1.5) return false;

  // Need either strong socials or known wallet activity
  if (c.socialScore < 35 && c.earlyBuyers.length < 2) return false;

  return alphaScore(c) >= 80;
}

function signalTier(
  c: Candidate,
  score: number,
  creatorScore: number
) {
  const smartWallets = c.earlyBuyers.length;

  const provenCreator = creatorScore >= 70;

  const whaleInterest =
    smartWallets >= 2;

  const breakout =
    c.marketCap &&
    c.marketCap <= 120_000 &&
    c.volume5m >= 15_000 &&
    c.liquidity >= 15_000 &&
    buyRatio(c) >= 1.8;

  if (
    score >= 88 &&
    (
      provenCreator ||
      whaleInterest ||
      breakout
    )
  ) {
    return 'P0';
  }

  if (
    score >= 78 &&
    (
      provenCreator ||
      whaleInterest
    )
  ) {
    return 'P1';
  }

  if (score >= 70) {
    return 'P2';
  }

  return 'REJECT';
}

function qualifiesForAutoBuy(c: Candidate, score: number) {
  return false;
}

function getRejectReasons(c: Candidate, score: number) {
  const reasons: string[] = [];

  if (looksBadSymbol(c.symbol)) reasons.push('bad_symbol');
  if (!c.hasStrongSocials) reasons.push('weak_socials');
  if (!c.marketCap || c.marketCap >= 80_000) reasons.push('market_cap');
  if (c.volume5m < 10_000) reasons.push('low_volume');
  if (c.liquidity < 12_000) reasons.push('low_liquidity');
  if (c.buys5m < 50) reasons.push('low_buys');
  if (sellBuyRatio(c) > 0.6) reasons.push('sell_pressure');
  if (buyRatio(c) < 1.6) reasons.push('weak_buy_ratio');
  if (c.ageMin > 60) reasons.push('too_old');
  if (score < 78) reasons.push('low_score');

  return reasons;
}

function makeBuyUrl(token: string) {
  return `https://jup.ag/swap/SOL-${token}`;
}

async function sendAlphaAlertToUsers(
  investigation: Investigation
) {
  const users = await getDeliverableUsers();
  console.log('══════════════════════════════');
    console.log('ALPHA ALERT');
    console.log('Users:', users.length);

    users.forEach((user) => {
      console.log({
        telegramId: user.telegram_id,
        username: user.username,
        firstName: user.first_name,
        tier: user.tier,
        subscription: user.subscription_status,
        blocked: user.is_blocked,
      });
    });

    console.log('══════════════════════════════');

  const message = renderTelegramInvestigation(investigation);

  for (const user of users) {
    const isAdmin = user.tier === 'admin';
    const isPaid =
      user.tier === 'paid' &&
      user.subscription_status === 'active';
    const isFree = user.tier === 'free';

    if (!(isAdmin || isPaid || isFree)) continue;

    const buttons = buildTelegramButtons(investigation, {
      isAdmin,
    });

    try {
      await sendTelegram(
        user.telegram_id,
        message,
        buttons
      );

      console.log('telegram alert sent:', {
        telegramId: user.telegram_id,
        username: user.username,
        tier: user.tier,
      });
      
        } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : String(error);

      console.log('alpha alert delivery failed:', {
        telegramId: user.telegram_id,
        username: user.username,
        tier: user.tier,
        error: errorMessage,
      });

      if (
        errorMessage.includes('403') ||
        errorMessage.includes('bot was blocked by the user') ||
        errorMessage.includes('chat not found')
      ) {
        await markTelegramUserBlocked(user.telegram_id);

        console.log('user marked blocked:', {
          telegramId: user.telegram_id,
          username: user.username,
        });
      }
    }
  }
}

async function fetchCandidates(): Promise<Candidate[]> {
  const profiles = await fetchLatestProfiles();
  if (!profiles.length) return [];

  const boostMap = await fetchBoostMap();
  const takeoverSet = await fetchTakeoverSet();

  const candidates: Candidate[] = [];

  for (const profile of profiles.slice(0, 20)) {
    try {
      const enriched = await enrichToken(profile, boostMap, takeoverSet);
      if (!enriched?.pair) continue;

      const pair: any = enriched.pair;
      const token = profile.tokenAddress!;
      const social = getSocialQuality(profile);
      const earlyBuyers = await getTokenBuyers(token);

      const liquidity = Number(pair.liquidity?.usd ?? 0);
      const volume5m = Number(pair.volume?.m5 ?? 0);
      const buys5m = Number(pair.txns?.m5?.buys ?? 0);
      const sells5m = Number(pair.txns?.m5?.sells ?? 0);

      const ageMin = Math.floor(
        (Date.now() - Number(pair.pairCreatedAt || Date.now())) / 60000
      );

      const priceUsd =
        pair.priceUsd != null && Number.isFinite(Number(pair.priceUsd))
          ? Number(pair.priceUsd)
          : null;

      const marketCap =
        pair.marketCap != null && Number.isFinite(Number(pair.marketCap))
          ? Number(pair.marketCap)
          : pair.fdv != null && Number.isFinite(Number(pair.fdv))
            ? Number(pair.fdv)
            : null;

      candidates.push({
        token,
        symbol: pair.baseToken?.symbol || 'Unknown',
        liquidity,
        volume5m,
        buys5m,
        sells5m,
        ageMin,
        priceUsd,
        marketCap,
        dexUrl: pair.url || `https://dexscreener.com/${config.discoveryChain}/${token}`,
        buyUrl: makeBuyUrl(token),
        socialScore: social.socialScore,
        socialSummary: social.socialSummary,
        hasStrongSocials: social.hasStrongSocials,
        websiteUrl: social.websiteUrl,
        xUrl: social.xUrl,
        telegramUrl: social.telegramUrl,
        earlyBuyers,
        creatorWallet:
            (profile as any).creatorWallet ??
            (profile as any).creator ??
            (await getCreatorWalletForToken(token)),
      });
    } catch (error) {
      console.log('dexPaid candidate skip', profile.tokenAddress, error);
    }
  }

  return candidates;
}

export async function runDexPaidEngine() {
  const candidates = await fetchCandidates();

  for (const c of candidates) {
    if (seen.has(c.token)) continue;

  let score = alphaScore(c);

    const learningAdjustment = {
      totalAdjustment: 0,
      reasons: [],
    };

    const label = conviction(score);
    const passes = qualifies(c);
    const autoBuyPasses = qualifiesForAutoBuy(c, score);

    let consolidationRisk = { score: 0 };

    let holderRisk = { score: 0, level: 'LOW', reasons: [] as string[], topHolderCount: 0 };

    const creatorWallet =
  c.creatorWallet ?? (await getCreatorWalletForTokenV2(c.token));

    const creatorIntel = await getCreatorIntelligenceV2(creatorWallet);

    const creatorScore = creatorIntel.score;
    const tier = signalTier(
      c,
      score,
      creatorScore
    );
    const creatorLabel = creatorTrustLabel(creatorScore);

    
    const shouldRunHolderRisk =
      score >= 70 &&
      c.liquidity >= 6_000 &&
      c.volume5m >= 3_000;

    if (shouldRunHolderRisk) {
      try {
        holderRisk = await getHolderRisk(c.token);

        console.log('holder risk check:', {
          token: c.token,
          symbol: c.symbol,
          score,
          holderRisk,
        });

        if (holderRisk.score >= 70) {
          console.log('filtered holder concentration risk:', {
            token: c.token,
            symbol: c.symbol,
            holderRisk,
          });

          seen.add(c.token);
          continue;
        }
      } catch (err) {
        console.log('holder risk error:', {
          token: c.token,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      console.log('holder risk skipped for low-priority candidate:', {
        token: c.token,
        symbol: c.symbol,
        score,
        liquidity: c.liquidity,
        volume5m: c.volume5m,
      });
    }

    try {
      consolidationRisk = await getConsolidationRisk(c.token, c.earlyBuyers);

      console.log('consolidation check:', {
        token: c.token,
        buyers: c.earlyBuyers.length,
        consolidationRisk,
      });

      if (consolidationRisk.score >= 75) {
        console.log('filtered consolidation dump risk:', {
          token: c.token,
          symbol: c.symbol,
          consolidationRisk,
        });

        seen.add(c.token);
        continue;
      }
    } catch (err) {
      console.log('consolidation error:', err);
    }

    const confidenceResult = calculateConfidence({
  score,
  creatorScore,
  smartWalletCount: c.earlyBuyers.length,
  liquidity: c.liquidity,
  volume5m: c.volume5m,
  buys5m: c.buys5m,
  sells5m: c.sells5m,
  socialScore: c.socialScore,
  holderRiskScore: holderRisk.score,
  bundleRiskScore: consolidationRisk.score,
  marketCap: c.marketCap,
  ageMin: c.ageMin,
});

const aiDecision = await recordDecisionForToken({
  token: c.token,
  symbol: c.symbol,
  input: {
    score,
    marketSafetyScore: score,
    authoritySafetyScore: 40,
    liquidityUsd: c.liquidity,
    volume5m: c.volume5m,
    buys5m: c.buys5m,
    sells5m: c.sells5m,

    // These now contain the completed risk checks.
    holderRiskScore: holderRisk.score,
    bundleRiskScore: consolidationRisk.score,

    smartWalletCount: c.earlyBuyers.length,
  },
});

console.log('final intelligence decision:', {
  token: c.token,
  symbol: c.symbol,
  score,
  creatorScore,
  holderRiskScore: holderRisk.score,
  bundleRiskScore: consolidationRisk.score,
  confidence: confidenceResult.confidence,
  riskLevel: confidenceResult.riskLevel,
  aiVerdict: aiDecision.verdict,
  aiDecisionConfidence: aiDecision.confidence,
});

   if (score < 60) {
    console.log('alpha candidate rejected before tier:', {
      token: c.token,
      symbol: c.symbol,
      score,
      liquidity: c.liquidity,
      marketCap: c.marketCap,
      volume5m: c.volume5m,
      buys5m: c.buys5m,
      sells5m: c.sells5m,
      ageMin: c.ageMin,
      rejectReasons: getRejectReasons(c, score),
    });

    continue;
  }

    console.log('alpha radar dex candidate:', {
      token: c.token,
      symbol: c.symbol,
      score,
      label,
      tier,
      confidence: confidenceResult.confidence,
      riskLevel: confidenceResult.riskLevel,
      confidenceReasons: confidenceResult.reasons,
      liquidity: c.liquidity,
      marketCap: c.marketCap,
      volume5m: c.volume5m,
      buys5m: c.buys5m,
      sells5m: c.sells5m,
      buyRatio: buyRatio(c).toFixed(2),
      sellBuyRatio: sellBuyRatio(c).toFixed(2),
      ageMin: c.ageMin,
      socials: c.socialSummary,
      socialScore: c.socialScore,
      earlyBuyers: c.earlyBuyers.length,
      passes,
      autoBuyPasses,
      rejectReasons: getRejectReasons(c, score),
    });

    if (tier === 'REJECT') {
      continue;
    }

    seen.add(c.token);

    await upsertTokenMemory({
      token: c.token,
      symbol: c.symbol,
      chain: 'solana',
      creatorWallet,
      marketCap: c.marketCap,
      liquidity: c.liquidity,
      price: c.priceUsd,
      buys: c.buys5m,
      sells: c.sells5m,
      confidence: confidenceResult.confidence,
      riskLevel: confidenceResult.riskLevel,
      creatorScore,
      holderScore: holderRisk.score,
      raw: {
        source: 'DEX_PAID',
        tier,
        score,
        socialScore: c.socialScore,
        socialSummary: c.socialSummary,
      },
    });

    addAlphaSignal({
      type: 'DEX_PAID',
      title: 'DEX Market Review',
      symbol: c.symbol,
      token: c.token,
      score,
      conviction: label,
      summary: `MC ${fmtUsd(c.marketCap)} • Liq ${fmtUsd(c.liquidity)} • Vol ${fmtUsd(c.volume5m)} • Socials ${c.socialSummary}`,
      dexUrl: c.dexUrl,
      buyUrl: c.buyUrl,
      alertPrice: c.priceUsd,
      currentPrice: c.priceUsd,
      highAfterAlert: c.priceUsd,
    });

    if (autoBuyPasses && config.adminTradingEnabled) {
      await startAdminAutoTrade({
        token: c.token,
        symbol: c.symbol,
        entryPrice: c.priceUsd!,
        amountSol: 0.05,
      });
    }

    const aiReasons = [
  ...aiDecision.reasons,
  ...confidenceResult.reasons,
];

const reportBaseUrl =
  process.env.ALPHAOS_WEB_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  '';

const reportUrl = reportBaseUrl
  ? `${reportBaseUrl.replace(/\/$/, '')}/report/${c.token}`
  : undefined;

const investigation = buildInvestigation({
  chain: config.discoveryChain || 'solana',

  token: {
    address: c.token,
    symbol: c.symbol,
  },

  signal: {
    tier: tier as 'P0' | 'P1' | 'P2',
    ageMinutes: c.ageMin,
  },

  market: {
    marketCap: c.marketCap,
    liquidity: c.liquidity,
    volume5m: c.volume5m,
    priceUsd: c.priceUsd,
  },

  orderflow: {
    buys5m: c.buys5m,
    sells5m: c.sells5m,
    buyRatio: buyRatio(c),
  },

  ai: {
    baseScore:
      score - learningAdjustment.totalAdjustment,
    historicalEdge:
      learningAdjustment.totalAdjustment,
    finalScore: score,
    confidence: confidenceResult.confidence,
    decisionConfidence: aiDecision.confidence,
    verdict: aiDecision.verdict,
    riskLevel: confidenceResult.riskLevel,
    reasons: aiReasons,
  },

  creator: {
    wallet: creatorIntel.creatorWallet,
    status: creatorIntel.status,
    score: creatorIntel.score,
    launches: creatorIntel.totalLaunches,
    crossed50k: creatorIntel.crossed50k,
    crossed100k: creatorIntel.crossed100k,
    crossed250k: creatorIntel.crossed250k,
    bestMarketCap: creatorIntel.bestMarketCap,
    verdict: creatorIntel.verdict,
  },

  risk: {
    holderScore: holderRisk.score,
    holderLevel: holderRisk.level,
    holderHasData: holderRisk.topHolderCount > 0,
    bundleScore: consolidationRisk.score,
    bundleHasData: c.earlyBuyers.length > 0,
    knownBuyers: c.earlyBuyers.length,
  },

  socials: {
    score: c.socialScore,
    summary: c.socialSummary,
    websiteUrl: c.websiteUrl,
    xUrl: c.xUrl,
    telegramUrl: c.telegramUrl,
  },

  links: {
    reportUrl,
    chartUrl: c.dexUrl,
    buyUrl: c.buyUrl,
  },
});

    if (!canSendTokenAlert(c.token, 'DEX_PAID')) {
  continue;
}

const minimumConfidenceByTier: Record<'P0' | 'P1' | 'P2', number> = {
  P0: 72,
  P1: 66,
  P2: 60,
};

const minimumRequiredConfidence =
  minimumConfidenceByTier[tier as 'P0' | 'P1' | 'P2'];

if (confidenceResult.confidence < minimumRequiredConfidence) {
  console.log('alert blocked by final confidence gate:', {
    token: c.token,
    symbol: c.symbol,
    tier,
    score,
    confidence: confidenceResult.confidence,
    minimumRequiredConfidence,
    riskLevel: confidenceResult.riskLevel,
    creatorScore,
    holderRiskScore: holderRisk.score,
    bundleRiskScore: consolidationRisk.score,
  });

  continue;
}

console.log('alert approved by final intelligence gate:', {
  token: c.token,
  symbol: c.symbol,
  tier,
  score,
  confidence: confidenceResult.confidence,
  minimumRequiredConfidence,
});

await sendAlphaAlertToUsers(investigation);
  }

  console.log("runDexPaidEngine finished");
}
