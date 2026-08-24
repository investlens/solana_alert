export type AlphaNotificationCategory =
  | 'opportunity'
  | 'wallet'
  | 'creator'
  | 'smart-money'
  | 'market'
  | 'risk'
  | 'execution'
  | 'system';

export type AlphaNotificationSeverity = 'info' | 'watch' | 'positive' | 'warning' | 'critical' | 'success';

export type AlphaNotificationState =
  | 'ENTRY_READY'
  | 'BUILDING'
  | 'RUNNER'
  | 'WATCHING'
  | 'BOOSTED_OPPORTUNITY'
  | 'EXIT_AVOID'
  | 'WALLET_BUY'
  | 'WALLET_SELL'
  | 'WALLET_LAUNCH'
  | 'WALLET_MOVE'
  | 'CREATOR_EVENT'
  | 'RISK'
  | 'EXECUTED'
  | 'FAILED'
  | 'PAUSED'
  | 'RESUMED'
  | 'POSITION_UPDATE';

export type AlphaNotificationMetric = {
  label: string;
  value: string | number | null | undefined;
};

export type AlphaNotification = {
  category: AlphaNotificationCategory;
  severity: AlphaNotificationSeverity;
  state: AlphaNotificationState;
  title?: string | null;
  subtitle?: string | null;
  token?: string | null;
  chain?: string | null;
  symbol?: string | null;
  address?: string | null;
  age?: string | null;
  confidence?: number | null;
  risk?: string | null;
  metrics?: AlphaNotificationMetric[];
  specialistMetrics?: AlphaNotificationMetric[];
  evidence?: string[];
  reason?: string | null;
  recommendedAction?: string | null;
  access?: 'FREE' | 'PRO' | 'ADMIN';
};

export type AlphaNotificationAction = {
  text: string;
  url?: string;
  callback_data?: string;
};

const STATE_LABELS: Record<AlphaNotificationState, string> = {
  ENTRY_READY: '🔥 ENTRY READY',
  BUILDING: '📈 BUILDING',
  RUNNER: '🏃 RUNNER',
  WATCHING: '👀 WATCHING',
  BOOSTED_OPPORTUNITY: '🚀 BOOSTED OPPORTUNITY',
  EXIT_AVOID: '🔴 EXIT / AVOID',
  WALLET_BUY: '🐋 WALLET BUY',
  WALLET_SELL: '🔴 WALLET EXIT',
  WALLET_LAUNCH: '🚀 WALLET LAUNCH',
  WALLET_MOVE: '🐋 WALLET MOVE',
  CREATOR_EVENT: '👨‍💻 CREATOR EVENT',
  RISK: '⚠️ RISK',
  EXECUTED: '✅ EXECUTED',
  FAILED: '⚠️ EXECUTION FAILED',
  PAUSED: '⏸ AUTO TRADE PAUSED',
  RESUMED: '▶ AUTO TRADE RESUMED',
  POSITION_UPDATE: '📈 POSITION UPDATE',
};

export function escapeAlphaHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function compactAlphaAddress(value?: string | null, start = 6, end = 5): string {
  const clean = String(value ?? '').trim();
  if (!clean) return '';
  if (clean.length <= start + end + 1) return clean;
  return `${clean.slice(0, start)}…${clean.slice(-end)}`;
}

export function normalizeAlphaSymbol(value?: string | null): string {
  return String(value ?? '').trim().replace(/^\$+/, '').toUpperCase();
}

export function alphaStateLabel(state: AlphaNotificationState): string {
  return STATE_LABELS[state];
}

export function assertAlphaActions(actions: AlphaNotificationAction[][]): AlphaNotificationAction[][] {
  for (const row of actions) {
    for (const action of row) {
      if (action.callback_data && Buffer.byteLength(action.callback_data, 'utf8') > 64) {
        throw new Error(`Telegram callback_data exceeds 64 bytes: ${action.callback_data}`);
      }
      if (action.url && !/^https:\/\//i.test(action.url)) {
        throw new Error(`Telegram action URL must use HTTPS: ${action.url}`);
      }
    }
  }
  return actions;
}

function validMetric(metric: AlphaNotificationMetric): boolean {
  return metric.value !== null && metric.value !== undefined && String(metric.value).trim() !== '';
}

export function renderAlphaNotification(alert: AlphaNotification): string {
  const compactAddress = compactAlphaAddress(alert.address);
  const symbol = normalizeAlphaSymbol(alert.symbol);
  const identity = symbol || alert.token || alert.title || compactAddress;
  const lines = [`<b>ALPHAOS · ${alphaStateLabel(alert.state)}</b>`];

  if (identity) {
    const identityParts = [
      `<b>${escapeAlphaHtml(identity)}</b>`,
      symbol && compactAddress ? `<code>${escapeAlphaHtml(compactAddress)}</code>` : null,
    ].filter(Boolean);
    lines.push('', identityParts.join(' · '));
  }
  const subtitle = String(alert.subtitle ?? '').trim();
  if (subtitle && subtitle.toLowerCase() !== identity.toLowerCase()) {
    lines.push(escapeAlphaHtml(subtitle));
  }
  if (alert.address && !symbol && identity !== compactAddress) {
    lines.push(`<code>${escapeAlphaHtml(compactAddress)}</code>`);
  }

  const decisionMetrics: AlphaNotificationMetric[] = [
    ...(alert.age ? [{ label: 'Age', value: alert.age }] : []),
    ...(alert.metrics ?? []),
    ...(alert.confidence != null && Number.isFinite(alert.confidence)
      ? [{ label: 'Confidence', value: `${Math.round(alert.confidence)}/100` }]
      : []),
    ...(alert.risk ? [{ label: 'Risk', value: alert.risk }] : []),
  ].filter(validMetric).slice(0, 8);
  const metrics = [
    ...decisionMetrics,
    ...(alert.specialistMetrics ?? []).filter(validMetric),
  ].slice(0, 12);

  if (metrics.length) {
    lines.push('');
    for (const metric of metrics) {
      lines.push(`${escapeAlphaHtml(metric.label).padEnd(11)} <b>${escapeAlphaHtml(metric.value)}</b>`);
    }
  }

  const evidence = (alert.evidence ?? []).map(value => String(value).trim()).filter(Boolean).slice(0, 2);
  if (alert.reason || evidence.length) {
    lines.push('', `🧠 ${escapeAlphaHtml(alert.reason ?? evidence[0])}`);
    for (const item of evidence.slice(alert.reason ? 0 : 1)) lines.push(`• ${escapeAlphaHtml(item)}`);
  }

  if (alert.recommendedAction) lines.push('', `<b>${escapeAlphaHtml(alert.recommendedAction)}</b>`);
  if (alert.access === 'FREE') lines.push('', '<i>Free intelligence may be delayed.</i>');

  return lines.join('\n');
}

export function burnEvidenceMetric(burnedAmount: number | null | undefined): AlphaNotificationMetric {
  if (burnedAmount == null || !Number.isFinite(burnedAmount)) {
    return { label: 'Burn', value: 'Data unavailable' };
  }
  return {
    label: 'Burn',
    value: burnedAmount === 0 ? '0 confirmed' : `${burnedAmount.toLocaleString()} confirmed`,
  };
}
