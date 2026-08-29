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
  displayIntent?: 'ENTRY' | 'MOMENTUM_UPDATE' | 'RECOVERY_WATCH' | 'WATCH' | 'AVOID' | 'EXIT';
  comparison?: { previous: number; current: number; changePct: number };
  entryAction?: 'BUY' | 'CHECK_ENTRY';
  developerContext?: string | null;
  structureContext?: string | null;
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
  BOOST: '🚀 BOOST DETECTED',
  MAJOR_BOOST: '🔥🚀 MAJOR BOOST',
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
  const intent = alert.displayIntent;
  const intentHeader = intent === 'ENTRY' ? '🎯 <b>ENTRY OPPORTUNITY</b>'
    : intent === 'MOMENTUM_UPDATE' ? '📈 <b>MOMENTUM UPDATE</b>'
    : intent === 'RECOVERY_WATCH' ? '👀 <b>RECOVERY WATCH</b>'
    : intent === 'WATCH' && alert.state === 'DEX_PAID' ? '💎 <b>DEX PAID</b>'
    : intent === 'WATCH' && alert.state === 'BOOST' ? '🚀 <b>BOOST DETECTED</b>'
    : intent === 'WATCH' && alert.state === 'MAJOR_BOOST' ? '🔥🚀 <b>MAJOR BOOST</b>'
    : intent === 'WATCH' ? 'ℹ️ <b>MARKET UPDATE</b>'
    : intent === 'EXIT' ? '🚨 <b>RISK ACTION</b>'
    : intent === 'AVOID' ? '🚫 <b>RISK ACTION</b>' : null;
  const lines = intentHeader
    ? [intentHeader, '', `🔥 <b>${escapeAlphaHtml(identity)}</b>`]
    : [`${alphaStateLabel(alert.state).split(' ')[0]} <b>${escapeAlphaHtml(alphaStateLabel(alert.state).replace(/^\S+\s*/, ''))} — ${escapeAlphaHtml(identity)}</b>`];
  if (intent === 'WATCH' && ['VOLUME_IGNITION'].includes(alert.state)) {
    lines.push(`${alphaStateLabel(alert.state).split(' ')[0]} <b>${escapeAlphaHtml(alphaStateLabel(alert.state).replace(/^\S+\s*/, ''))}</b>`);
  }

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

  if (intent === 'MOMENTUM_UPDATE' && alert.comparison) {
    const money = (value: number) => value < 1 ? `$${value.toPrecision(6).replace(/0+$/, '').replace(/\.$/, '')}` : `$${value.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
    lines.push('', `Previously alerted  <b>${money(alert.comparison.previous)}</b>`,
      `Now                 <b>${money(alert.comparison.current)}</b>`,
      `Change              <b>${alert.comparison.changePct >= 0 ? '+' : ''}${alert.comparison.changePct.toFixed(1)}%</b>`);
  }
  if (intent === 'ENTRY') lines.push('', alert.entryAction === 'BUY' ? '🟢 <b>ACTION: BUY SETUP</b>' : '🎯 <b>ACTION: CHECK ENTRY</b>',
    alert.entryAction === 'BUY' ? 'AlphaOS identified a qualified setup; execution remains manual.' : 'Conditions qualify for entry consideration.');
  if (intent === 'MOMENTUM_UPDATE') lines.push('', '📈 <b>ACTION: MOMENTUM UPDATE</b>', 'Previously alerted opportunity has a new qualified momentum signal.');
  if (intent === 'RECOVERY_WATCH') lines.push('', '👀 <b>ACTION: WATCH</b>', 'Recovery activity detected — entry not confirmed.');
  if (intent === 'WATCH') lines.push('', '👀 <b>ACTION: WATCH</b>', 'Information only — entry not confirmed.');
  if (intent === 'AVOID') lines.push('', '🚫 <b>ACTION: AVOID</b>');
  if (intent === 'EXIT') lines.push('', '🚨 <b>ACTION: EXIT</b>');

  const insightSource = alert.insight?.length ? alert.insight : alert.evidence?.length ? alert.evidence : alert.reason ? [alert.reason] : [];
  const insight = insightSource.flatMap(value => String(value ?? '').split(/(?<=[.!?])\s+/))
    .map(value => boundedAlphaText(value.replace(/[.!?]+$/, ''), 140)).filter(Boolean).slice(0, 3);
  if (insight.length) lines.push('', `📈 <b>${intent === 'MOMENTUM_UPDATE' || intent === 'RECOVERY_WATCH' || intent === 'WATCH' ? 'WHAT CHANGED' : 'WHY NOW'}</b>`, ...insight.map(item => `• ${escapeAlphaHtml(item)}`));
  if (alert.structureContext) lines.push('', `⚠️ ${escapeAlphaHtml(boundedAlphaText(alert.structureContext, 180))}`);
  if (alert.developerContext) lines.push('', `👨‍💻 <b>Dev:</b> ${escapeAlphaHtml(boundedAlphaText(alert.developerContext, 180))}`);
  const risk = String(alert.risk ?? 'UNKNOWN').toUpperCase();
  const riskIcon = risk === 'LOW' ? '✅' : risk === 'MEDIUM' || risk === 'REVIEW' ? '⚠️' : risk === 'HIGH' ? '🚨' : '⚪';
  lines.push('', `🧠 <b>AlphaOS:</b> ${escapeAlphaHtml(alert.state)}`, `${riskIcon} <b>Risk:</b> ${escapeAlphaHtml(risk === 'MEASURED' ? 'UNKNOWN' : risk)}`);
  lines.push('<i>Observed just now</i>');
  if (intent === 'MOMENTUM_UPDATE') lines.push('', '<i>This is an update to an earlier opportunity.</i>');
  if (intent === 'WATCH') lines.push('', '<i>AlphaOS is monitoring for entry confirmation.</i>');
  if (intent === 'RECOVERY_WATCH') lines.push('', '<i>AlphaOS is monitoring for structural recovery.</i>');
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
