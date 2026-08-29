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
  | 'OPPORTUNITY'
  | 'VOLUME_IGNITION'
  | 'DEX_PAID'
  | 'BOOST'
  | 'MAJOR_BOOST'
  | 'DEV_BURN'
  | 'DEV_SOLD'
  | 'CRITICAL_RISK'
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
  icon?: string;
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
  insightTitle?: string | null;
  insight?: string[];
  statusTitle?: string | null;
  status?: string | null;
  access?: 'FREE' | 'PRO' | 'ADMIN';
};

export type AlphaNotificationAction = {
  text: string;
  url?: string;
  callback_data?: string;
};

const STATE_LABELS: Record<AlphaNotificationState, string> = {
  ENTRY_READY: '🔥 ENTRY READY',
  OPPORTUNITY: '🎯 OPPORTUNITY',
  VOLUME_IGNITION: '🔥 VOLUME IGNITION',
  DEX_PAID: '💎 DEX PAID',
  BOOST: '🚀 BOOST',
  MAJOR_BOOST: '🚀 MAJOR BOOST',
  DEV_BURN: '🔥 DEV BURN',
  DEV_SOLD: '🚨 DEV SOLD',
  CRITICAL_RISK: '🚨 CRITICAL RISK',
  BUILDING: '📈 BUILDING',
  RUNNER: '🔥 RUNNER',
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

export const TELEGRAM_MESSAGE_LIMIT = 4096;
export function boundedAlphaText(value: unknown, max: number): string {
  const text = String(value ?? '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function compactAlphaAddress(value?: string | null, start = 6, end = 5): string {
  const clean = String(value ?? '').trim();
  if (!clean) return '';
  if (clean.length <= start + end + 1) return clean;
  return `${clean.slice(0, start)}…${clean.slice(-end)}`;
}

export function normalizeAlphaSymbol(value?: string | null): string {
  return boundedAlphaText(String(value ?? '').replace(/^\$+/, '').toUpperCase(), 64);
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
  const name = boundedAlphaText(alert.subtitle || alert.token || alert.title, 80);
  const identity = name && symbol ? `${name} ($${symbol})` : symbol ? `$${symbol}` : name || compactAddress;
  const lines = [`${alphaStateLabel(alert.state).split(' ')[0]} <b>${escapeAlphaHtml(alphaStateLabel(alert.state).replace(/^\S+\s*/, ''))} — ${escapeAlphaHtml(identity)}</b>`];

  if (alert.address) lines.push(symbol ? `<b>${escapeAlphaHtml(symbol)}</b> · <code>${escapeAlphaHtml(compactAddress)}</code>` : `<code>${escapeAlphaHtml(compactAddress)}</code>`);

  const decisionMetrics: AlphaNotificationMetric[] = [
    ...(alert.age ? [{ label: 'Age', value: alert.age }] : []),
    ...(alert.metrics ?? []),
  ].filter(validMetric).slice(0, 8);
  const metrics = [
    ...decisionMetrics,
    ...(alert.specialistMetrics ?? []).filter(validMetric),
  ].slice(0, 12);

  const take = (...labels: string[]) => metrics.find(metric => labels.includes(metric.label.toLowerCase()));
  const price = take('price'), marketCap = take('market cap', 'market cap', 'fdv'), liquidity = take('liquidity'), volume = take('5m volume');
  if (price || marketCap) lines.push('', `${price ? `💰 Price <b>${escapeAlphaHtml(boundedAlphaText(price.value, 80))}</b>` : ''}${price && marketCap ? '  •  ' : ''}${marketCap ? `${marketCap.label} <b>${escapeAlphaHtml(boundedAlphaText(marketCap.value, 80))}</b>` : ''}`);
  if (liquidity || volume) lines.push(`${liquidity ? `💧 Liquidity <b>${escapeAlphaHtml(boundedAlphaText(liquidity.value, 80))}</b>` : ''}${liquidity && volume ? '  •  ' : ''}${volume ? `5m volume <b>${escapeAlphaHtml(boundedAlphaText(volume.value, 80))}</b>` : ''}`);
  const secondary = metrics.filter(metric => ![price, marketCap, liquidity, volume].includes(metric)).slice(0, 3);
  for (const metric of secondary) lines.push(`${metric.icon ? `${escapeAlphaHtml(metric.icon)} ` : ''}${escapeAlphaHtml(boundedAlphaText(metric.label, 24))} <b>${escapeAlphaHtml(boundedAlphaText(metric.value, 80))}</b>`);

  const insightSource = alert.insight?.length ? alert.insight : alert.evidence?.length ? alert.evidence : alert.reason ? [alert.reason] : [];
  const insight = insightSource.map(value => boundedAlphaText(value, 140)).filter(Boolean).slice(0, 3);
  if (insight.length) lines.push('', '📈 <b>WHY NOW</b>', ...insight.map(item => `• ${escapeAlphaHtml(item)}`));
  const risk = String(alert.risk ?? 'UNKNOWN').toUpperCase();
  const riskIcon = risk === 'LOW' ? '✅' : risk === 'MEDIUM' || risk === 'REVIEW' ? '⚠️' : risk === 'HIGH' ? '🚨' : '⚪';
  lines.push('', `🧠 <b>AlphaOS:</b> ${escapeAlphaHtml(alert.state)}`, `${riskIcon} <b>Risk:</b> ${escapeAlphaHtml(risk === 'MEASURED' ? 'UNKNOWN' : risk)}`);
  lines.push('<i>Observed just now</i>');
  if (alert.access === 'FREE') lines.push('', '<i>Free intelligence may be delayed.</i>');

  const rendered = lines.join('\n');
  if (rendered.length > TELEGRAM_MESSAGE_LIMIT) throw new Error('Alpha notification exceeds Telegram message limit after bounded rendering');
  return rendered;
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
