import {
  burnEvidenceMetric,
  renderAlphaNotification,
  type AlphaNotificationMetric,
  type AlphaNotificationState,
} from './alphaNotification.js';

export function buildCreatorNotification(args: {
  symbol: string;
  address: string;
  risk?: boolean;
  holdingPercent?: number | null;
  transferredAmount?: number | null;
  burnedAmount?: number | null;
  burnObserved?: boolean;
  reputation?: string | null;
  reason: string;
}): string {
  const metrics: AlphaNotificationMetric[] = [];
  if (args.holdingPercent != null) metrics.push({ label: 'Dev holding', value: `${args.holdingPercent.toFixed(2)}%` });
  if (args.transferredAmount != null) metrics.push({ label: 'Transferred', value: args.transferredAmount });
  if (args.burnObserved) metrics.push(burnEvidenceMetric(args.burnedAmount));
  if (args.reputation) metrics.push({ label: 'Reputation', value: args.reputation });
  return renderAlphaNotification({
    category: args.risk ? 'risk' : 'creator',
    severity: args.risk ? 'critical' : 'positive',
    state: args.risk ? 'RISK' : 'CREATOR_EVENT',
    symbol: args.symbol,
    address: args.address,
    risk: args.risk ? 'HIGH' : 'REVIEW',
    metrics,
    reason: args.reason,
    recommendedAction: args.risk ? 'Protect capital · review now.' : 'Review creator evidence and market conditions.',
  });
}

export function buildExecutionNotification(args: {
  state: Extract<AlphaNotificationState, 'EXECUTED' | 'FAILED' | 'PAUSED' | 'RESUMED' | 'POSITION_UPDATE'>;
  symbol?: string | null;
  address?: string | null;
  metrics?: AlphaNotificationMetric[];
  reason?: string | null;
}): string {
  return renderAlphaNotification({
    category: 'execution',
    severity: args.state === 'FAILED' ? 'critical' : args.state === 'PAUSED' ? 'warning' : 'success',
    state: args.state,
    symbol: args.symbol,
    address: args.address,
    metrics: args.metrics,
    reason: args.reason,
    access: 'ADMIN',
  });
}
