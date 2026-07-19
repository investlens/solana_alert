import type { CreatorProfile } from '../profiles/creatorProfile.js';
import { buildAlphaAlert, compactAddress, formatUsd } from './alphaAlert/index.js';

function fmtPct(value?: number | null): string {
  return value == null || !Number.isFinite(value) ? 'Tracking' : `${value.toFixed(1)}%`;
}

function launchVerdict(score?: number | null): { status: string; risk: string; title: string } {
  if (score == null || !Number.isFinite(score)) return { status: 'SCANNING', risk: 'UNKNOWN', title: 'EARLY DATA COLLECTION' };
  if (score >= 90) return { status: 'HIGH CONVICTION', risk: 'REVIEW REQUIRED', title: 'PRIORITY LAUNCH INVESTIGATION' };
  if (score >= 80) return { status: 'STRONG EARLY SIGNAL', risk: 'ELEVATED', title: 'WORTH INVESTIGATING' };
  if (score >= 75) return { status: 'WATCHLIST', risk: 'ELEVATED', title: 'MONITOR CLOSELY' };
  if (score >= 60) return { status: 'HIGH-RISK WATCH', risk: 'HIGH', title: 'WAIT FOR CONFIRMATION' };
  return { status: 'LOW QUALITY', risk: 'HIGH', title: 'AVOID UNTIL RISK CLEARS' };
}

export function buildPumpfunEarlyMessage(args: {
  symbol?: string | null;
  name?: string | null;
  mint: string;
  creator?: string | null;
  creatorProfile?: CreatorProfile | null;
  progressPct?: number | null;
  buyCount?: number | null;
  sellCount?: number | null;
  volumeUsd?: number | null;
  marketCapUsd?: number | null;
  launchScore?: number | null;
  isMutable?: boolean | null;
}) {
  const creator = args.creatorProfile;
  const symbol = args.symbol || 'UNKNOWN';
  const name = args.name || symbol;
  const buys = args.buyCount ?? 0;
  const sells = args.sellCount ?? 0;
  const assessment = launchVerdict(args.launchScore);

  return buildAlphaAlert({
    title: 'PUMP.FUN RADAR · FRESH LAUNCH',
    subtitle: 'Early lifecycle intelligence',
    tone: (args.launchScore ?? 0) >= 80 ? 'PREMIUM' : 'WATCH',
    symbol,
    name,
    address: args.mint,
    score: args.launchScore,
    confidence: args.launchScore,
    risk: assessment.risk,
    status: assessment.status,
    sections: [
      {
        title: 'LAUNCH SNAPSHOT',
        icon: '📊',
        metrics: [
          { label: 'Market Cap', value: formatUsd(args.marketCapUsd) },
          { label: 'Volume', value: formatUsd(args.volumeUsd) },
          { label: 'Curve Progress', value: fmtPct(args.progressPct) },
          { label: 'Buys / Sells', value: `${buys}/${sells}` },
          { label: 'Metadata', value: args.isMutable === false ? 'Immutable' : args.isMutable === true ? 'Mutable' : 'Tracking' },
        ],
      },
      {
        title: 'CREATOR INTELLIGENCE',
        icon: '👤',
        metrics: [
          { label: 'Wallet', value: compactAddress(args.creator) },
          { label: 'Rating', value: creator?.rating ?? 'UNKNOWN' },
          { label: 'Trust Score', value: `${creator?.trustScore ?? 50}/100` },
          { label: 'Launches', value: creator?.launches ?? 0 },
          { label: 'Successful', value: creator?.successfulLaunches ?? 0 },
          { label: 'Best Market Cap', value: formatUsd(creator?.highestMarketCap ?? 0) },
        ],
      },
      {
        title: 'EVIDENCE CHECK',
        icon: '🔎',
        items: [
          `${(args.launchScore ?? 0) >= 75 ? '✅' : '⚠️'} Launch quality: ${args.launchScore ?? 'Tracking'}/100`,
          `${args.isMutable === false ? '✅' : '⚠️'} Metadata: ${args.isMutable === false ? 'Immutable' : 'Needs monitoring'}`,
          `${buys > sells ? '✅' : '⚠️'} Buy pressure: ${buys}/${sells}`,
          '⚠️ Very early launches remain highly volatile',
        ],
      },
    ],
    verdictTitle: assessment.title,
    verdict: creator?.hasData ? `Creator history is available with a ${creator.rating} rating and ${creator.trustScore}/100 trust score.` : 'Creator history is incomplete. AlphaOS is learning this wallet while monitoring the launch.',
    tracking: 'LAUNCH & CREATOR TRACKING ACTIVE',
  });
}
