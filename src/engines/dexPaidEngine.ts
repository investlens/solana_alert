import { config } from '../config.js';
import { sendTelegram } from '../services/telegram.js';
import { getDeliverableUsers } from '../core/delivery.js';
import { getConsolidationRisk } from '../scoring/consolidationRisk.js';
import { addAlphaSignal } from './alphaFeed.js';
import { recordDecisionForToken } from '../agents/decisionAgent.js';
import { canSendTokenAlert } from '../core/alertDeduper.js';
import {
  getCreatorReputation,
  creatorTrustLabel,
} from '../core/creatorReputation.js';
import { getHolderRisk } from '../scoring/holderRisk.js';
import {
  startAdminAutoTrade,
  canStartNewTrade,
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

  const text = links
    .map((l: any) => `${l.type ?? ''} ${l.label ?? ''} ${l.url ?? ''}`)
    .join(' ')
    .toLowerCase();

  const hasX =
    text.includes('twitter') ||
    text.includes('x.com') ||
    text.includes('twitter.com');

  const hasTelegram = text.includes('telegram') || text.includes('t.me');

  const hasWebsite = links.some((l: any) => {
    const url = String(l.url ?? '').toLowerCase();
    return url.startsWith('http') && !url.includes('dexscreener');
  });

  let score = 0;
  const parts: string[] = [];

  if (hasX) {
    score += 25;
    parts.push('X');
  }

  if (hasTelegram) {
    score += 20;
    parts.push('Telegram');
  }

  if (hasWebsite) {
    score += 10;
    parts.push('Website');
  }

  return {
    socialScore: score,
    socialSummary: parts.length ? parts.join(' + ') : 'No verified socials',
    hasStrongSocials: score >= 25,
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
  if (score >= 85) return 'WHALE GRADE';
  if (score >= 75) return 'HIGH CONVICTION';
  if (score >= 70) return 'STRONG WATCH';
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

async function sendAlphaAlertToUsers(args: {
  message: string;
  token: string;
  dexUrl: string;
  buyUrl: string;
}) {
  const users = await getDeliverableUsers();

  for (const user of users) {
    const isAdmin = user.tier === 'admin';
    const isPaid = user.tier === 'paid' && user.subscription_status === 'active';
    const isFree = user.tier === 'free';

    if (!(isAdmin || isPaid || isFree)) continue;

    const buttons = isAdmin
  ? [
      [
        { text: '📈 Chart', url: args.dexUrl },
        { text: '🟢 Jupiter', url: args.buyUrl },
      ],
      [
        { text: '⚡ Buy 0.03 SOL', callback_data: `ADMIN_BUY_SMALL_${args.token}` },
        { text: '🔥 Buy 0.05 SOL', callback_data: `ADMIN_BUY_DEFAULT_${args.token}` },
      ],
      [
        { text: '⏸ Pause Auto', callback_data: 'PAUSE_AUTO_TRADE' },
        { text: '📊 Auto Status', callback_data: 'AUTO_TRADE_STATUS' },
      ],
    ]
  : [
      [
        { text: '📈 Chart', url: args.dexUrl },
        { text: '🟢 Buy', url: args.buyUrl },
      ],
    ];

    try {
      await sendTelegram(user.telegram_id, args.message, buttons);
    } catch (error) {
      console.log('alpha alert delivery failed:', {
        telegramId: user.telegram_id,
        tier: user.tier,
        error: error instanceof Error ? error.message : String(error),
      });
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
      const earlyBuyers = getTokenBuyers(token);

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
        earlyBuyers,
        creatorWallet: null,
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

    const score = alphaScore(c);
    const label = conviction(score);
    const passes = qualifies(c);
    const autoBuyPasses = qualifiesForAutoBuy(c, score);

    let consolidationRisk = { score: 0 };

    let holderRisk = { score: 0, level: 'LOW', reasons: [] as string[], topHolderCount: 0 };

    const creatorRep = await getCreatorReputation(c.creatorWallet);
    const creatorScore = creatorRep?.trust_score ?? 50;
    const tier = signalTier(
      c,
      score,
      creatorScore
    );
    const creatorLabel = creatorTrustLabel(creatorScore);

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
        holderRiskScore: holderRisk.score,
        bundleRiskScore: consolidationRisk.score,
        smartWalletCount: c.earlyBuyers.length,
      },
    });

    try {
      holderRisk = await getHolderRisk(c.token);

      console.log('holder risk check:', {
        token: c.token,
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
      console.log('holder risk error:', err);
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

    if (score < 60) continue;

    console.log('alpha radar dex candidate:', {
      token: c.token,
      symbol: c.symbol,
      score,
      label,
      tier,
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

    addAlphaSignal({
      type: 'DEX_PAID',
      title:
        label === 'WHALE GRADE'
          ? '🐋 Whale Grade Alpha'
          : '🔥 High Conviction Alpha',
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

    const barUnits = Math.max(0, Math.min(10, Math.floor(score / 10)));
    const confidenceBar = '█'.repeat(barUnits) + '░'.repeat(10 - barUnits);

    const entryTiming =
      c.ageMin <= 10 ? '🔥 EARLY' :
      c.ageMin <= 30 ? '⚡ EARLY-MID' :
      c.ageMin <= 60 ? '🟡 MID' :
      '🔻 LATE';

    const message = [
      tier === 'P0'
      ? '🐋 <b>P0 BLUE CHIP SIGNAL</b>'
      : tier === 'P1'
        ? '🔥 <b>P1 HIGH CONVICTION SIGNAL</b>'
        : '👀 <b>P2 WATCHLIST SIGNAL</b>',
      '━━━━━━━━━━━━━━━━━━',
      '',
      `<b>${escapeHtml(c.symbol)}</b>`,
      `<code>${escapeHtml(c.token)}</code>`,
      '',
      `Score: <b>${score}/100</b>`,
      `Confidence: <b>${confidenceBar}</b>`,
      `Timing: <b>${entryTiming}</b>`,
      '',
      '📊 <b>Market</b>',
      `MC: <b>${fmtUsd(c.marketCap)}</b>`,
      `Liq: <b>${fmtUsd(c.liquidity)}</b>`,
      `Vol(5m): <b>${fmtUsd(c.volume5m)}</b>`,
      '',
      '⚡ <b>Orderflow</b>',
      `Buy Ratio: <b>${buyRatio(c).toFixed(2)}x</b>`,
      `Buys/Sells: <b>${c.buys5m}/${c.sells5m}</b>`,
      '',
      '🌐 <b>Socials</b>',
      `<b>${escapeHtml(c.socialSummary)}</b>`,
      '',
      '🧠 <b>Creator</b>',
        `Trust: <b>${creatorLabel}</b> (${creatorScore}/100)`,
        '',

        '🤖 <b>AI Verdict</b>',
        `Decision: <b>${aiDecision.verdict}</b>`,
        `Confidence: <b>${aiDecision.confidence}/100</b>`,
        `Reason: <b>${
          aiDecision.reasons.slice(0, 2).join(', ') ||
          'Watching conditions'
        }</b>`,
        '',

        '🛡 <b>Risk</b>',
      `Holder Risk: <b>${
        holderRisk.topHolderCount > 0
          ? `${holderRisk.score}/100`
          : 'Data unavailable'
      }</b>`,
      `Bundle Risk: <b>${
        c.earlyBuyers.length > 0
          ? `${consolidationRisk.score}/100`
          : 'Not enough wallet data'
      }</b>`,
      `Known Buyers: <b>${c.earlyBuyers.length}</b>`,
      '',
      '🤖 <b>Auto Trade</b>',
      isAutoTradePaused()
        ? '⏸ Paused'
        : autoBuyPasses
          ? '🟢 Live (Ready)'
          : '👀 Monitoring',
    ].join('\n');

    if (!canSendTokenAlert(c.token, 'DEX_PAID')) {
      continue;
    }

    if (tier === 'P0' || tier === 'P1') {
      await sendAlphaAlertToUsers({
        message,
        token: c.token,
        dexUrl: c.dexUrl,
        buyUrl: c.buyUrl,
      });
    }
  }
}
