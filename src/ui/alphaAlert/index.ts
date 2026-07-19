export type AlphaAlertTone = 'POSITIVE' | 'WATCH' | 'RISK' | 'NEUTRAL' | 'PREMIUM';

export type AlphaAlertMetric = {
  label: string;
  value: string | number | null | undefined;
};

export type AlphaAlertSection = {
  title: string;
  icon?: string;
  metrics?: AlphaAlertMetric[];
  items?: string[];
};

export type AlphaAlertCard = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  tone?: AlphaAlertTone;
  symbol?: string | null;
  name?: string | null;
  address?: string | null;
  score?: number | null;
  confidence?: number | null;
  risk?: string | null;
  status?: string | null;
  sections?: AlphaAlertSection[];
  verdictTitle?: string;
  verdict?: string;
  disclaimer?: string;
  tracking?: string;
};

const DIVIDER = '━━━━━━━━━━━━━━━━━━';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function compactAddress(value?: string | null, start = 6, end = 5): string {
  const clean = String(value ?? '').trim();
  if (!clean) return 'Tracking';
  if (clean.length <= start + end + 3) return clean;
  return `${clean.slice(0, start)}…${clean.slice(-end)}`;
}

export function formatUsd(value?: number | null): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return 'Tracking';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

export function confidenceBar(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '░░░░░░░░░░';
  const normalized = Math.max(0, Math.min(100, value));
  const filled = Math.round(normalized / 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
}

function toneIcon(tone: AlphaAlertTone): string {
  if (tone === 'POSITIVE') return '🟢';
  if (tone === 'WATCH') return '🟡';
  if (tone === 'RISK') return '🔴';
  if (tone === 'PREMIUM') return '✦';
  return '⚪';
}

function cleanItems(items?: string[]): string[] {
  return (items ?? []).map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 5);
}

export function buildAlphaAlert(card: AlphaAlertCard): string {
  const lines: string[] = [];
  const tone = card.tone ?? 'NEUTRAL';

  lines.push('✦ <b>ALPHAOS INTELLIGENCE</b>');
  lines.push(`${toneIcon(tone)} <b>${escapeHtml(card.title)}</b>`);
  if (card.subtitle) lines.push(`<i>${escapeHtml(card.subtitle)}</i>`);
  lines.push(DIVIDER);

  if (card.symbol || card.name || card.address) {
    lines.push('');
    if (card.symbol) lines.push(`🪙 <b>${escapeHtml(card.symbol)}</b>${card.name && card.name !== card.symbol ? `  <i>${escapeHtml(card.name)}</i>` : ''}`);
    else if (card.name) lines.push(`🪙 <b>${escapeHtml(card.name)}</b>`);
    if (card.address) lines.push(`<code>${escapeHtml(compactAddress(card.address))}</code>`);
  }

  if (card.score != null || card.confidence != null || card.risk || card.status) {
    lines.push('');
    lines.push('🧠 <b>INTELLIGENCE SUMMARY</b>');
    if (card.score != null && Number.isFinite(card.score)) lines.push(`Alpha Score  <b>${Math.round(card.score)}/100</b>`);
    if (card.confidence != null && Number.isFinite(card.confidence)) {
      lines.push(`Confidence  <b>${Math.round(card.confidence)}%</b>`);
      lines.push(`<code>${confidenceBar(card.confidence)}</code>`);
    }
    if (card.risk) lines.push(`Risk  <b>${escapeHtml(card.risk)}</b>`);
    if (card.status) lines.push(`Status  <b>${escapeHtml(card.status)}</b>`);
  }

  for (const section of card.sections ?? []) {
    const metrics = (section.metrics ?? []).filter((metric) => metric.value !== null && metric.value !== undefined && String(metric.value).trim() !== '');
    const items = cleanItems(section.items);
    if (!metrics.length && !items.length) continue;

    lines.push('');
    lines.push(`${section.icon ?? '◆'} <b>${escapeHtml(section.title)}</b>`);
    for (const metric of metrics) lines.push(`${escapeHtml(metric.label)}  <b>${escapeHtml(metric.value)}</b>`);
    for (const item of items) lines.push(`${item.startsWith('✅') || item.startsWith('⚠️') || item.startsWith('❌') || item.startsWith('•') ? '' : '• '}${escapeHtml(item).replace(/^✅ /, '✅ ').replace(/^⚠️ /, '⚠️ ').replace(/^❌ /, '❌ ')}`);
  }

  if (card.verdict || card.verdictTitle) {
    lines.push('');
    lines.push('🤖 <b>ALPHAOS VERDICT</b>');
    if (card.verdictTitle) lines.push(`<b>${escapeHtml(card.verdictTitle)}</b>`);
    if (card.verdict) lines.push(escapeHtml(card.verdict));
  }

  lines.push('');
  lines.push(DIVIDER);
  if (card.tracking) lines.push(`📚 <b>${escapeHtml(card.tracking)}</b>`);
  if (card.disclaimer) lines.push(`<i>${escapeHtml(card.disclaimer)}</i>`);
  else lines.push('<i>Evidence for investigation — not a trade recommendation.</i>');

  return lines.join('\n');
}
