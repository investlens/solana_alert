import type { CreatorProfile } from '../profiles/creatorProfile.js';
import { compactAlphaAddress, renderAlphaNotification } from './alphaNotification.js';
import { formatUsd } from './alphaAlert/index.js';
import { marketContextMetrics, normalizeNotificationMarketContext } from './notificationMarketContext.js';

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
  const market = normalizeNotificationMarketContext({
    symbol: args.symbol, name: args.name, mint: args.mint, marketCapUsd: args.marketCapUsd,
  });
  return renderAlphaNotification({
    category: 'creator',
    severity: (score ?? 0) >= 80 ? 'positive' : 'watch',
    state: 'CREATOR_EVENT',
    symbol: market.symbol,
    subtitle: market.name,
    address: market.address,
    confidence: score,
    risk,
    metrics: [
      ...marketContextMetrics(market),
      ...(args.volumeUsd != null && Number.isFinite(args.volumeUsd) && args.volumeUsd > 0
        ? [{ label: 'Volume', value: formatUsd(args.volumeUsd) }] : []),
      { label: 'Curve', value: args.progressPct == null ? 'Data unavailable' : `${args.progressPct.toFixed(1)}%` },
      ...(args.buyCount != null || args.sellCount != null
        ? [{ label: 'Buys / sells', value: `${args.buyCount ?? '–'}/${args.sellCount ?? '–'}` }] : []),
      { label: 'Creator', value: compactAlphaAddress(args.creator) || 'Data unavailable' },
      { label: 'Reputation', value: creator?.hasData ? `${creator.rating} · ${creator.trustScore}/100` : 'Data unavailable' },
    ],
    reason: creator?.hasData
      ? 'A fresh launch was detected with measured creator history.'
      : 'A fresh launch was detected; creator history is incomplete.',
    recommendedAction: (score ?? 0) >= 75 ? 'Monitor for confirmation.' : 'Avoid until risk clears.',
  });
}
