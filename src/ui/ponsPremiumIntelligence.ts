import { compactAlphaAddress, escapeAlphaHtml } from './alphaNotification.js';
import {
  coreDecisionEvidenceMetrics,
  marketContextMetrics,
  type CoreDecisionMetricContext,
  type NotificationMarketContext,
} from './notificationMarketContext.js';

export type PonsPremiumState = 'BUILDING' | 'CONFIRMED' | 'RUNNER';

const iconForState = (state: PonsPremiumState) => state === 'BUILDING' ? '📈' : '🔥';
const sectionForState = (state: PonsPremiumState) =>
  state === 'BUILDING' ? 'STRUCTURE' : state === 'CONFIRMED' ? 'CONFIRMATION' : 'CONTINUATION';
const statusForState = (state: PonsPremiumState) =>
  state === 'BUILDING'
    ? ['⏳', 'Building · waiting for sustained confirmation.']
    : state === 'CONFIRMED'
      ? ['🎯', 'Entry conditions confirmed · verify live market before acting.']
      : ['🚀', 'Continuation remains strong · monitor live conditions.'];

const metricIcons: Record<string, string> = {
  'Market cap': '💵', FDV: '💰', Liquidity: '💧', '5m volume': '📊',
  Move: '📈', Peak: '🏔', Retained: '🛡', 'Dev holding': '👤', Burned: '🔥', Risk: '✅',
  Market: '⏳', Confidence: '🎯', Transferred: '↗️',
};

export function ponsEvidenceCopy(args: {
  state: PonsPremiumState; retainedPeakPercent?: number | null;
  indexedMarket: boolean; market: NotificationMarketContext; evidence: CoreDecisionMetricContext;
  confirmedDevSell?: boolean;
}): string[] {
  if (args.state === 'RUNNER') {
    return [`Confirmation survived a later checkpoint and price retained ${args.retainedPeakPercent ?? 0}% of its peak move.`];
  }
  if (args.state === 'CONFIRMED') return ['Multiple checkpoints continue to support the setup.'];
  if (args.indexedMarket && args.market.liquidity != null && args.market.volume5m != null) {
    return ['Price remains constructive while market participation is holding.'];
  }
  if (args.evidence.devHoldingEvidence === 'VERIFIED' && !args.confirmedDevSell) {
    return [
      'Price has held its early move across multiple checkpoints.',
      'Developer position remains stable with no confirmed sell evidence.',
    ];
  }
  if (args.market.preIndexValuation != null) return ['Early curve strength has survived the confirmation window.'];
  return ['Price has held its early move across multiple checkpoints.'];
}

export function renderPonsPremiumIntelligence(args: {
  state: PonsPremiumState; symbol?: string | null; name?: string | null; address: string;
  age?: string | null; market: NotificationMarketContext; evidence: CoreDecisionMetricContext;
  move?: number | null; peakMove?: number | null; retainedPeakPercent?: number | null;
  risk?: string | null; confidence?: number | null; marketIndexing?: boolean;
  transferredPercent?: number | null; confirmedDevSell?: boolean;
}): string {
  const symbol = String(args.symbol ?? '').trim().replace(/^\$+/, '').toUpperCase();
  const name = String(args.name ?? '').trim();
  const identity = symbol || name || compactAlphaAddress(args.address);
  const lines = [`${iconForState(args.state)} <b>ALPHAOS · ${args.state}</b>`, '',
    `<b>${escapeAlphaHtml(identity)}</b> · <code>${escapeAlphaHtml(compactAlphaAddress(args.address))}</code>`];
  if (symbol && name && name.toLowerCase() !== symbol.toLowerCase()) lines.push(escapeAlphaHtml(name));

  const marketMetrics = marketContextMetrics(args.market);
  const evidenceMetrics = coreDecisionEvidenceMetrics(args.evidence);
  const metrics = [
    ...(args.age ? [{ label: 'Age', value: args.age, icon: '⏱' }] : []),
    ...marketMetrics.map(metric => ({ ...metric, icon: metricIcons[metric.label] ?? '•' })),
    ...(args.marketIndexing ? [{ label: 'Market', value: 'INDEXING', icon: '⏳' }] : []),
    ...(args.move == null ? [] : [{ label: 'Move', value: `${args.move >= 0 ? '+' : ''}${args.move.toFixed(1)}%`, icon: '📈' }]),
    ...(args.peakMove == null ? [] : [{ label: 'Peak', value: `${args.peakMove >= 0 ? '+' : ''}${args.peakMove.toFixed(1)}%`, icon: '🏔' }]),
    ...(args.retainedPeakPercent == null ? [] : [{ label: 'Retained', value: `${args.retainedPeakPercent}%`, icon: '🛡' }]),
    ...evidenceMetrics.map(metric => ({ ...metric, icon: metricIcons[metric.label] ?? '•' })),
    ...(args.transferredPercent == null ? [] : [{ label: 'Transferred', value: `${args.transferredPercent.toFixed(2)}%`, icon: '↗️' }]),
    ...(args.confidence == null || !Number.isFinite(args.confidence)
      ? [] : [{ label: 'Confidence', value: `${Math.round(args.confidence)}/100`, icon: '🎯' }]),
    ...(args.risk ? [{ label: 'Risk', value: args.risk, icon: '✅' }] : []),
  ];
  if (metrics.length) {
    lines.push('');
    for (const metric of metrics) {
      lines.push(`${metric.icon} ${escapeAlphaHtml(metric.label).padEnd(12)} <b>${escapeAlphaHtml(metric.value)}</b>`);
    }
  }

  lines.push('', `🧠 <b>${sectionForState(args.state)}</b>`);
  lines.push(...ponsEvidenceCopy({ state: args.state, retainedPeakPercent: args.retainedPeakPercent,
    indexedMarket: args.market.marketCap != null, market: args.market, evidence: args.evidence,
    confirmedDevSell: args.confirmedDevSell }).map(escapeAlphaHtml));
  const [statusIcon, status] = statusForState(args.state);
  lines.push('', `${statusIcon} <b>STATUS</b>`, escapeAlphaHtml(status));
  if (args.marketIndexing) lines.push('Market data is still indexing.');
  return lines.join('\n');
}
