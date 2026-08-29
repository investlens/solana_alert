import { renderAlphaNotification, type AlphaNotificationState } from './alphaNotification.js';
import { formatUsd } from './alphaAlert/index.js';
import type { CoreDecisionMetricContext, NotificationMarketContext } from './notificationMarketContext.js';

type PremiumState = Extract<AlphaNotificationState,
  'OPPORTUNITY' | 'VOLUME_IGNITION' | 'DEX_PAID' | 'BOOST' | 'MAJOR_BOOST' |
  'DEV_BURN' | 'DEV_SOLD' | 'CRITICAL_RISK' | 'BUILDING' | 'RUNNER'>;

const percent = (value: number) => `${Number(value.toFixed(2))}%`;
const price = (value: number) => value >= 1 ? `$${value.toLocaleString('en-US', { maximumFractionDigits: 4 })}`
  : `$${value.toPrecision(5).replace(/0+$/, '').replace(/\.$/, '')}`;

export function buildPremiumTokenNotification(args: {
  state: PremiumState; symbol?: string | null; name?: string | null; address: string;
  age?: string | null; market: NotificationMarketContext; evidence?: CoreDecisionMetricContext | null;
  volumeMultiple?: number | null; move?: number | null; peakMove?: number | null;
  retainedPeakPercent?: number | null; boostTotal?: number | null; boostIncrement?: number | null;
  devLaunches?: number | null; devBurnPercent?: number | null; risk?: string | null; confidence?: number | null;
  insightTitle: string; insight: string[]; statusTitle: string; status: string;
  displayIntent?: 'ENTRY' | 'MOMENTUM_UPDATE' | 'RECOVERY_WATCH' | 'WATCH' | 'AVOID' | 'EXIT';
  comparison?: { previous: number; current: number; changePct: number };
  entryAction?: 'BUY' | 'CHECK_ENTRY';
  structureContext?: string | null;
}) {
  const marketCap = args.market.marketCap;
  const fdv = marketCap == null ? args.market.fdv : null;
  const metrics = [
    ...(args.market.price == null ? [] : [{ icon: '💰', label: 'Price', value: price(args.market.price) }]),
    ...(args.age ? [{ icon: '⏱', label: 'Age', value: args.age }] : []),
    ...(marketCap == null ? [] : [{ icon: '💰', label: 'Market cap', value: formatUsd(marketCap) }]),
    ...(fdv == null ? [] : [{ icon: '💰', label: 'FDV', value: formatUsd(fdv) }]),
    ...(args.market.liquidity == null ? [] : [{ icon: '💧', label: 'Liquidity', value: formatUsd(args.market.liquidity) }]),
    ...(args.market.volume5m == null ? [] : [{ icon: '🔥', label: '5m volume', value: formatUsd(args.market.volume5m) }]),
    ...(args.volumeMultiple == null ? [] : [{ icon: '📈', label: 'Volume', value: `${args.volumeMultiple.toFixed(1)}×` }]),
    ...(args.move == null ? [] : [{ icon: '📊', label: 'Move', value: `${args.move >= 0 ? '+' : ''}${args.move.toFixed(1)}%` }]),
    ...(args.peakMove == null ? [] : [{ icon: '🏔', label: 'Peak', value: `${args.peakMove >= 0 ? '+' : ''}${args.peakMove.toFixed(1)}%` }]),
    ...(args.retainedPeakPercent == null ? [] : [{ icon: '🛡', label: 'Retained', value: `${args.retainedPeakPercent}%` }]),
    ...(args.boostTotal == null ? [] : [{ icon: '🚀', label: 'Boost', value: `${args.boostTotal} total${args.boostIncrement == null ? '' : ` (+${args.boostIncrement})`}` }]),
  ];
  const developerParts = [
    ...(args.evidence?.devHoldingEvidence === 'VERIFIED' && args.evidence.devHoldingPercent != null
      ? [`Holds ${percent(args.evidence.devHoldingPercent)}`] : []),
    ...(args.devBurnPercent != null && Number.isFinite(args.devBurnPercent)
      ? [`Burned ${percent(args.devBurnPercent)}`] : []),
    ...(args.devLaunches != null && args.devLaunches > 0 ? [`${args.devLaunches} observed launches`] : []),
  ];
  return renderAlphaNotification({
    category: ['DEV_SOLD', 'CRITICAL_RISK'].includes(args.state) ? 'risk' : 'market',
    severity: ['DEV_SOLD', 'CRITICAL_RISK'].includes(args.state) ? 'critical' :
      ['OPPORTUNITY', 'VOLUME_IGNITION', 'DEX_PAID', 'DEV_BURN'].includes(args.state) ? 'positive' : 'watch',
    state: args.state, symbol: args.symbol, subtitle: args.name, address: args.address,
    confidence: args.confidence, risk: args.risk, metrics,
    insightTitle: args.insightTitle, insight: args.insight,
    statusTitle: args.statusTitle, status: args.status,
    displayIntent: args.displayIntent ?? (args.state === 'OPPORTUNITY' ? 'ENTRY'
      : args.state === 'DEV_SOLD' || args.state === 'CRITICAL_RISK' ? 'AVOID' : 'WATCH'),
    comparison: args.comparison,
    entryAction: args.entryAction,
    developerContext: developerParts.length ? developerParts.join(' · ') : null,
    structureContext: args.structureContext,
  });
}
