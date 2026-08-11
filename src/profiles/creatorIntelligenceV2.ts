import { supabase } from '../services/supabase.js';
import { getCreatorWalletForToken } from './tokenCreatorLookup.js';

export type CreatorIntelligenceV2 = {
  creatorWallet: string | null;
  status: 'UNKNOWN' | 'NEW' | 'WATCH' | 'PROMISING' | 'PROVEN' | 'RISKY';
  score: number;
  totalLaunches: number;
  crossed50k: number;
  crossed100k: number;
  crossed250k: number;
  crossed500k: number;
  crossed1m: number;
  bestMarketCap: number;
  avgPeakMarketCap: number;
  lastLaunchAt: string | null;
  verdict: string;
  strengths: string[];
  risks: string[];
};

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function fmtUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 'n/a';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

function shortWallet(wallet?: string | null) {
  if (!wallet) return 'n/a';
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

function getStatus(score: number, launches: number): CreatorIntelligenceV2['status'] {
  if (!launches) return 'UNKNOWN';
  if (score >= 85) return 'PROVEN';
  if (score >= 70) return 'PROMISING';
  if (score >= 55) return 'WATCH';
  if (score <= 35) return 'RISKY';
  return 'NEW';
}

export async function getCreatorWalletForTokenV2(
  token: string | null | undefined
): Promise<string | null> {
  return getCreatorWalletForToken(token);
}

export async function getCreatorIntelligenceV2(
  creatorWallet: string | null | undefined,
  chain = 'solana',
): Promise<CreatorIntelligenceV2> {
  if (!creatorWallet) {
    return {
      creatorWallet: null,
      status: 'UNKNOWN',
      score: 50,
      totalLaunches: 0,
      crossed50k: 0,
      crossed100k: 0,
      crossed250k: 0,
      crossed500k: 0,
      crossed1m: 0,
      bestMarketCap: 0,
      avgPeakMarketCap: 0,
      lastLaunchAt: null,
      verdict: 'Creator wallet unavailable. Treat as unverified.',
      strengths: [],
      risks: ['Creator wallet unavailable'],
    };
  }

  const { data, error } = await supabase
    .from('creator_launches')
    .select(
      'token, symbol, peak_market_cap, crossed_50k, crossed_100k, crossed_250k, crossed_500k, crossed_1m, severe_crash, catastrophic_crash, launched_at'
    )
    .eq(
  'chain',
  chain,
)
.eq(
  'creator_wallet',
  creatorWallet,
)
    .order('launched_at', { ascending: false })
    .limit(100);

  if (error) {
    console.log('getCreatorIntelligenceV2 error:', error.message);
  }

  const rows = data ?? [];
  const totalLaunches = rows.length;

  const crossed50k = rows.filter((r: any) => r.crossed_50k).length;
  const crossed100k = rows.filter((r: any) => r.crossed_100k).length;
  const crossed250k = rows.filter((r: any) => r.crossed_250k).length;
  const crossed500k = rows.filter((r: any) => r.crossed_500k).length;
  const crossed1m =
  rows.filter(
    (r: any) =>
      r.crossed_1m,
  ).length;

  const severeCrashes =
  rows.filter(
    (r: any) =>
      r.severe_crash,
  ).length;

const catastrophicCrashes =
  rows.filter(
    (r: any) =>
      r.catastrophic_crash,
  ).length;

  const peaks = rows.map((r: any) => num(r.peak_market_cap)).filter((x) => x > 0);
  const bestMarketCap = peaks.length ? Math.max(...peaks) : 0;
  const avgPeakMarketCap = peaks.length
    ? peaks.reduce((sum, x) => sum + x, 0) / peaks.length
    : 0;

  let score = 50;
  const strengths: string[] = [];
  const risks: string[] = [];

  if (totalLaunches >= 10) {
    score += 10;
    strengths.push(`${totalLaunches} previous launches tracked`);
  } else if (totalLaunches >= 3) {
    score += 5;
    strengths.push(`${totalLaunches} launches tracked`);
  } else if (totalLaunches === 1) {
    risks.push('New creator with limited history');
  }

  if (crossed1m > 0) {
    score += 25;
    strengths.push(`${crossed1m} token(s) crossed $1M`);
  } else if (crossed500k > 0) {
    score += 18;
    strengths.push(`${crossed500k} token(s) crossed $500K`);
  } else if (crossed250k > 0) {
    score += 12;
    strengths.push(`${crossed250k} token(s) crossed $250K`);
  } else if (crossed100k > 0) {
    score += 8;
    strengths.push(`${crossed100k} token(s) crossed $100K`);
  } else if (crossed50k > 0) {
    score += 5;
    strengths.push(`${crossed50k} token(s) crossed $50K`);
  } else if (totalLaunches >= 5) {
    score -= 12;
    risks.push('Multiple launches but no tracked breakout yet');
  }

  if (bestMarketCap >= 1_000_000) score += 10;
  else if (bestMarketCap >= 500_000) score += 6;
  else if (bestMarketCap >= 100_000) score += 3;

  if (totalLaunches >= 20 && crossed50k === 0) {
  score -= 15;
  risks.push('High launch count with weak tracked outcomes');
}


/*
 * Reward repeat high-quality creators.
 */
if (crossed500k >= 2) {
  score += 10;

  strengths.push(
    `${crossed500k} launches crossed $500K`,
  );
}


if (crossed1m >= 2) {
  score += 10;

  strengths.push(
    `${crossed1m} launches crossed $1M`,
  );
}


/*
 * Penalize creators with repeated catastrophic outcomes.
 */
if (
  totalLaunches >= 3 &&
  catastrophicCrashes >= 2
) {
  score -= 20;

  risks.push(
    `${catastrophicCrashes} catastrophic launch crashes`,
  );
}


if (
  totalLaunches >= 5 &&
  severeCrashes / totalLaunches >= 0.6
) {
  score -= 20;

  risks.push(
    'Majority of tracked launches suffered severe crashes',
  );
}


score = Math.max(
  0,
  Math.min(
    100,
    Math.round(score),
  ),
);

  const status = getStatus(score, totalLaunches);

  const verdict =
    status === 'PROVEN'
      ? `Proven creator. Best tracked market cap ${fmtUsd(bestMarketCap)}.`
      : status === 'PROMISING'
        ? `Promising creator with some positive launch history.`
        : status === 'WATCH'
          ? `Creator has limited but usable history. Watch confirmation signals.`
          : status === 'RISKY'
            ? `Creator history looks weak based on tracked launches.`
            : totalLaunches > 0
              ? `New or unproven creator. Limited performance evidence.`
              : `No creator history available yet.`;

  return {
    creatorWallet,
    status,
    score,
    totalLaunches,
    crossed50k,
    crossed100k,
    crossed250k,
    crossed500k,
    crossed1m,
    bestMarketCap,
    avgPeakMarketCap,
    lastLaunchAt: rows[0]?.launched_at ?? null,
    verdict,
    strengths,
    risks,
  };
}

export function buildCreatorIntelligenceV2Lines(intel: CreatorIntelligenceV2) {
  const lines: string[] = [];

  lines.push('👤 <b>Creator Intelligence</b>');

  if (!intel.creatorWallet || intel.status === 'UNKNOWN') {
    lines.push('Status: <b>Not identified yet</b>');
    lines.push('Verdict: <b>Creator wallet not available for this token source.</b>');
    lines.push('Note: AlphaOS will continue tracking once creator data is available.');
    return lines;
  }

  lines.push(`Wallet: <code>${shortWallet(intel.creatorWallet)}</code>`);
  lines.push(`Status: <b>${intel.status}</b>`);
  lines.push(`Score: <b>${intel.score}/100</b>`);
  lines.push(`Launches Tracked: <b>${intel.totalLaunches}</b>`);

  if (intel.bestMarketCap > 0) {
    lines.push(`Best MC: <b>${fmtUsd(intel.bestMarketCap)}</b>`);
  }

  const wins =
    intel.crossed1m > 0
      ? `${intel.crossed1m} crossed $1M`
      : intel.crossed500k > 0
        ? `${intel.crossed500k} crossed $500K`
        : intel.crossed250k > 0
          ? `${intel.crossed250k} crossed $250K`
          : intel.crossed100k > 0
            ? `${intel.crossed100k} crossed $100K`
            : intel.crossed50k > 0
              ? `${intel.crossed50k} crossed $50K`
              : null;

  if (wins) {
    lines.push(`Wins: <b>${wins}</b>`);
  }

  lines.push(`Verdict: <b>${intel.verdict}</b>`);

  if (intel.strengths.length) {
    lines.push('');
    lines.push('<b>Strengths</b>');
    lines.push(...intel.strengths.slice(0, 2).map((x) => `✅ ${x}`));
  }

  if (intel.risks.length) {
    lines.push('');
    lines.push('<b>Risks</b>');
    lines.push(...intel.risks.slice(0, 2).map((x) => `⚠️ ${x}`));
  }

  return lines;
}