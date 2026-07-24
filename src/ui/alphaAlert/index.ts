export type AlphaAlertTone =
  | 'POSITIVE'
  | 'WATCH'
  | 'RISK'
  | 'NEUTRAL'
  | 'PREMIUM';

export type AlphaAlertAccess =
  | 'PREMIUM'
  | 'FREE';

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
  access?: AlphaAlertAccess;

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

  tracking?: string;
  disclaimer?: string;
};

const DIVIDER = '━━━━━━━━━━━━━━━━━━';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function compactAddress(
  value?: string | null,
  start = 6,
  end = 5,
): string {
  const clean = String(value ?? '').trim();

  if (!clean) {
    return 'Tracking';
  }

  if (clean.length <= start + end + 3) {
    return clean;
  }

  return `${clean.slice(0, start)}…${clean.slice(-end)}`;
}

export function formatUsd(value?: number | null): string {
  if (
    value == null ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return 'Tracking';
  }

  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }

  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }

  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }

  return `$${Math.round(value)}`;
}

export function confidenceBar(value?: number | null): string {
  if (
    value == null ||
    !Number.isFinite(value)
  ) {
    return '░░░░░░░░░░';
  }

  const normalized = Math.max(
    0,
    Math.min(100, value),
  );

  const filled = Math.round(
    normalized / 10,
  );

  return `${'█'.repeat(filled)}${'░'.repeat(
    10 - filled,
  )}`;
}

function toneIcon(
  tone: AlphaAlertTone,
): string {
  switch (tone) {
    case 'PREMIUM':
      return '✦';

    case 'POSITIVE':
      return '🟢';

    case 'WATCH':
      return '🟡';

    case 'RISK':
      return '🔴';

    default:
      return '⚪';
  }
}

function accessLabel(
  access: AlphaAlertAccess,
): string {
  return access === 'FREE'
    ? 'FREE INTELLIGENCE'
    : 'PREMIUM INTELLIGENCE';
}

function cleanItems(
  items?: string[],
): string[] {
  return (items ?? [])
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 4);
}

function hasValue(
  value: unknown,
): boolean {
  return (
    value !== null &&
    value !== undefined &&
    String(value).trim() !== ''
  );
}

function formatItem(
  item: string,
): string {
  const escaped = escapeHtml(item);

  if (
    item.startsWith('✅') ||
    item.startsWith('⚠️') ||
    item.startsWith('❌') ||
    item.startsWith('🔒') ||
    item.startsWith('•')
  ) {
    return escaped;
  }

  return `• ${escaped}`;
}

export function buildAlphaAlert(
  card: AlphaAlertCard,
): string {
  const lines: string[] = [];

  const tone = card.tone ?? 'NEUTRAL';
  const access = card.access ?? 'PREMIUM';

  /*
   * Header
   */
  lines.push('✦ <b>ALPHAOS</b>');
  lines.push(
    `<i>${escapeHtml(accessLabel(access))}</i>`,
  );

  lines.push('');

  /*
   * Alert Title
   */
  lines.push(
    `${toneIcon(tone)} <b>${escapeHtml(card.title)}</b>`,
  );

  if (card.subtitle) {
    lines.push(
      `<i>${escapeHtml(card.subtitle)}</i>`,
    );
  }

  lines.push(DIVIDER);

  /*
   * Token Information
   */
  if (
    card.symbol ||
    card.name ||
    card.address
  ) {
    const symbol =
      card.symbol ||
      card.name ||
      'UNKNOWN';

    const showName =
      card.name &&
      card.name !== symbol;

    lines.push('');

    lines.push(
      `🪙 <b>${escapeHtml(symbol)}</b>${
        showName
          ? ` · ${escapeHtml(card.name)}`
          : ''
      }`,
    );

    if (card.address) {
      lines.push(
        `<code>${escapeHtml(
          compactAddress(card.address),
        )}</code>`,
      );
    }
  }

  /*
   * AI Summary
   */
  const hasSummary =
    hasValue(card.score) ||
    hasValue(card.confidence) ||
    hasValue(card.risk) ||
    hasValue(card.status);

  if (hasSummary) {
    lines.push('');
    lines.push('🧠 <b>AI SUMMARY</b>');

    if (
      card.score != null &&
      Number.isFinite(card.score)
    ) {
      lines.push(
        `Alpha Score  <b>${Math.round(
          card.score,
        )}/100</b>`,
      );
    }

    if (
      card.confidence != null &&
      Number.isFinite(card.confidence)
    ) {
      lines.push(
        `Confidence  <b>${Math.round(
          card.confidence,
        )}%</b>`,
      );

      lines.push(
        `<code>${confidenceBar(
          card.confidence,
        )}</code>`,
      );
    }

    if (card.risk) {
      lines.push(
        `Risk  <b>${escapeHtml(
          card.risk,
        )}</b>`,
      );
    }

    if (card.status) {
      lines.push(
        `Action  <b>${escapeHtml(
          card.status,
        )}</b>`,
      );
    }
  }

  /*
   * Evidence Sections
   */
  for (const section of card.sections ?? []) {
    const metrics = (
      section.metrics ?? []
    )
      .filter((metric) =>
        hasValue(metric.value),
      )
      .slice(0, 6);

    const items = cleanItems(
      section.items,
    );

    if (
      !metrics.length &&
      !items.length
    ) {
      continue;
    }

    lines.push('');

    lines.push(
      `${section.icon ?? '◆'} <b>${escapeHtml(
        section.title,
      )}</b>`,
    );

    for (const metric of metrics) {
      lines.push(
        `${escapeHtml(
          metric.label,
        )}  <b>${escapeHtml(
          metric.value,
        )}</b>`,
      );
    }

    for (const item of items) {
      lines.push(
        formatItem(item),
      );
    }
  }

    /*
   * AI Verdict
   */
  if (card.verdictTitle || card.verdict) {
    lines.push('');
    lines.push('🤖 <b>AI VERDICT</b>');

    if (card.verdictTitle) {
      lines.push(
        `<b>${escapeHtml(card.verdictTitle)}</b>`,
      );
    }

    if (card.verdict) {
      lines.push(
        escapeHtml(card.verdict),
      );
    }
  }

  /*
   * Footer
   */
  lines.push('');
  lines.push(DIVIDER);

  if (card.tracking) {
    lines.push(
      `📚 <b>${escapeHtml(
        card.tracking,
      )}</b>`,
    );
  }

  if (access === 'FREE') {
    lines.push(
      '',
      '🔒 <b>Premium Intelligence Locked</b>',
      'Unlock Creator Intelligence',
      'Unlock Smart Wallet Tracking',
      'Unlock Holder Analysis',
      'Unlock Advanced Risk Intelligence',
    );
  }

  lines.push('');

  if (card.disclaimer) {
    lines.push(
      `<i>${escapeHtml(
        card.disclaimer,
      )}</i>`,
    );
  } else {
    lines.push(
      '<i>AI-generated intelligence for research purposes only. Always perform your own due diligence before trading.</i>',
    );
  }

  return lines.join('\n');
}