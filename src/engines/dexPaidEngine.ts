import { config } from '../config.js';
import { sendTelegram } from '../services/telegram.js';
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
};

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

  if (c.volume5m >= 3_000) score += 10;
  if (c.volume5m >= 8_000) score += 10;
  if (c.volume5m >= 20_000) score += 10;

  if (c.buys5m >= 50) score += 8;
  if (c.buys5m >= 150) score += 8;

  return Math.min(score, 30);
}

function liquidityScore(c: Candidate) {
  let score = 0;

  if (c.liquidity >= 7_000) score += 10;
  if (c.liquidity >= 15_000) score += 5;
  if (c.liquidity >= 25_000) score += 5;

  return Math.min(score, 20);
}

function orderflowScore(c: Candidate) {
  let score = 0;
  const ratio = buyRatio(c);

  if (ratio >= 1.15) score += 8;
  if (ratio >= 1.35) score += 9;
  if (ratio >= 2) score += 8;

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

  if (looksBadSymbol(c.symbol)) penalty += 25;
  if (c.volume5m < 500) penalty += 15;
  if (c.buys5m <= c.sells5m) penalty += 15;
  if (c.ageMin > 120) penalty += 15;
  if (c.liquidity < 2_000) penalty += 20;

  return penalty;
}

function alphaScore(c: Candidate) {
  const raw =
    momentumScore(c) +
    liquidityScore(c) +
    orderflowScore(c) +
    freshnessScore(c);

  return Math.max(0, Math.min(100, raw - riskPenalty(c)));
}

function conviction(score: number) {
  if (score >= 85) return 'WHALE GRADE';
  if (score >= 75) return 'STRONG ALPHA';
  if (score >= 65) return 'WATCHLIST';
  return 'IGNORE';
}

function qualifies(c: Candidate) {
  if (looksBadSymbol(c.symbol)) return false;

  return (
    c.liquidity >= 7_000 &&
    c.volume5m >= 3_000 &&
    buyRatio(c) >= 1.35 &&
    c.ageMin <= 90 &&
    alphaScore(c) >= 65
  );
}

function makeBuyUrl(token: string) {
  return `https://jup.ag/swap/SOL-${token}`;
}

async function fetchCandidates(): Promise<Candidate[]> {
  const profiles = await fetchLatestProfiles();
  if (!profiles.length) return [];

  const boostMap = await fetchBoostMap();
  const takeoverSet = await fetchTakeoverSet();

  const candidates: Candidate[] = [];

  for (const profile of profiles.slice(0, 15)) {
    try {
      const enriched = await enrichToken(profile, boostMap, takeoverSet);
      if (!enriched?.pair) continue;

      const pair: any = enriched.pair;
      const token = profile.tokenAddress!;

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

    console.log('alpha radar dex candidate:', {
      token: c.token,
      symbol: c.symbol,
      score,
      label,
      liquidity: c.liquidity,
      volume5m: c.volume5m,
      buys5m: c.buys5m,
      sells5m: c.sells5m,
      buyRatio: buyRatio(c).toFixed(2),
      ageMin: c.ageMin,
      passes: qualifies(c),
    });

    if (!qualifies(c)) continue;

    seen.add(c.token);

    await sendTelegram(
      config.ownerChatId,
      [
        label === 'WHALE GRADE'
          ? '🐋 <b>WHALE GRADE ALPHA</b>'
          : label === 'STRONG ALPHA'
            ? '🔥 <b>STRONG ALPHA</b>'
            : '💎 <b>DEX PAID WATCHLIST</b>',
        '',
        `<b>${c.symbol}</b>`,
        `Alpha Score: <b>${score}/100</b>`,
        `Conviction: <b>${label}</b>`,
        '',
        `Market Cap / FDV: <b>${fmtUsd(c.marketCap)}</b>`,
        `Current Price: <b>${fmtPrice(c.priceUsd)}</b>`,
        `Liquidity: <b>${fmtUsd(c.liquidity)}</b>`,
        `5m Volume: <b>${fmtUsd(c.volume5m)}</b>`,
        `Buys/Sells: <b>${c.buys5m}/${c.sells5m}</b>`,
        `Buy Ratio: <b>${buyRatio(c).toFixed(2)}x</b>`,
        `Age: <b>${c.ageMin}m</b>`,
        '',
        'Why it fired:',
        '• DEX paid / profiled token',
        '• Liquidity is tradable',
        '• 5m volume is active',
        '• Buy pressure is stronger than sell pressure',
        '',
        `Mint: <code>${c.token}</code>`,
      ].join('\n'),
      [
        [
          { text: '📈 DexScreener', url: c.dexUrl },
          { text: '🟢 Buy on Jupiter', url: c.buyUrl },
        ],
        [
          { text: 'Buy 0.03 SOL', callback_data: `ADMIN_BUY_SMALL_${c.token}` },
          { text: 'Buy 0.05 SOL', callback_data: `ADMIN_BUY_DEFAULT_${c.token}` },
        ],
      ]
    );
  }
}