import type { CreatorProfile } from '../profiles/creatorProfile.js';
import { compactAlphaAddress, renderAlphaNotification } from './alphaNotification.js';
import { formatUsd } from './alphaAlert/index.js';

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
  const score = args.launchScore;
  const risk = score == null ? 'REVIEW' : score >= 80 ? 'ELEVATED' : 'HIGH';
  return renderAlphaNotification({
    category: 'creator',
    severity: (score ?? 0) >= 80 ? 'positive' : 'watch',
    state: 'CREATOR_EVENT',
    symbol: args.symbol || 'UNKNOWN',
    subtitle: args.name,
    address: args.mint,
    confidence: score,
    risk,
    metrics: [
      { label: 'Market cap', value: formatUsd(args.marketCapUsd) },
      { label: 'Volume', value: formatUsd(args.volumeUsd) },
      { label: 'Curve', value: args.progressPct == null ? 'Data unavailable' : `${args.progressPct.toFixed(1)}%` },
      { label: 'Buys / sells', value: `${args.buyCount ?? 0}/${args.sellCount ?? 0}` },
      { label: 'Creator', value: compactAlphaAddress(args.creator) || 'Data unavailable' },
      { label: 'Reputation', value: creator?.hasData ? `${creator.rating} · ${creator.trustScore}/100` : 'Data unavailable' },
    ],
    reason: creator?.hasData
      ? 'A fresh launch was detected with measured creator history.'
      : 'A fresh launch was detected; creator history is incomplete.',
    recommendedAction: (score ?? 0) >= 75 ? 'Monitor for confirmation.' : 'Avoid until risk clears.',
  });
}
