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

function isInternalNoise(
  value: string,
): boolean {
  const text =
    value.toLowerCase();

  return (
    text.includes(
      'alpha memory',
    ) ||
    text.includes(
      'outcome monitoring',
    ) ||
    text.includes(
      'tracking active',
    ) ||
    text.includes(
      'event recorded',
    )
  );
}

function compactMetricLines(
  card: AlphaAlertCard,
): string[] {
  const lines: string[] = [];

  if (
    card.score != null &&
    Number.isFinite(
      card.score,
    )
  ) {
    lines.push(
      `Score       <b>${Math.round(
        card.score,
      )}</b>`,
    );
  }

  if (
    card.confidence != null &&
    Number.isFinite(
      card.confidence,
    )
  ) {
    lines.push(
      `Confidence  <b>${Math.round(
        card.confidence,
      )}</b>`,
    );
  }

  if (card.risk) {
    lines.push(
      `Risk        <b>${escapeHtml(
        card.risk,
      )}</b>`,
    );
  }

  if (card.status) {
    lines.push(
      `Action      <b>${escapeHtml(
        card.status,
      )}</b>`,
    );
  }

  return lines.slice(
    0,
    4,
  );
}

function compactEvidenceLines(
  card: AlphaAlertCard,
): string[] {
  const lines: string[] = [];

  for (
    const section
    of card.sections ??
    []
  ) {
    const metrics =
      (
        section.metrics ??
        []
      )
        .filter(
          metric =>
            hasValue(
              metric.value,
            ),
        )
        .slice(
          0,
          3,
        );

    const meaningfulItems =
      (
        section.items ??
        []
      )
        .map(
          item =>
            String(
              item,
            ).trim(),
        )
        .filter(
          item =>
            Boolean(
              item,
            ) &&
            !isInternalNoise(
              item,
            ),
        )
        .slice(
          0,
          1,
        );

    if (
      metrics.length ===
      0 &&
      meaningfulItems.length ===
      0
    ) {
      continue;
    }

    if (
      lines.length ===
      0
    ) {
      lines.push(
        '',
        `${section.icon ??
          '📊'} <b>${escapeHtml(
          section.title,
        )}</b>`,
      );
    }

    for (
      const metric
      of metrics
    ) {
      lines.push(
        `${escapeHtml(
          metric.label,
        )}  <b>${escapeHtml(
          metric.value,
        )}</b>`,
      );
    }

    for (
      const item
      of meaningfulItems
    ) {
      lines.push(
        escapeHtml(
          item,
        ),
      );
    }

    /*
     * One evidence section is enough for the
     * compact Telegram card. Deeper evidence
     * belongs in Research / Opportunity Detail.
     */
    break;
  }

  return lines;
}

export function buildAlphaAlert(
  card: AlphaAlertCard,
): string {
  const tone =
    card.tone ??
    'NEUTRAL';

  const icon =
    toneIcon(
      tone,
    );

  const title =
    String(
      card.title ??
      'INTELLIGENCE',
    )
      .replace(
        /^ALPHAOS\s*·?\s*/i,
        '',
      )
      .trim();

  const lines: string[] = [
    `${icon} <b>ALPHAOS · ${escapeHtml(
      title,
    )}</b>`,
  ];

  if (card.subtitle) {
    lines.push(
      escapeHtml(
        card.subtitle,
      ),
    );
  }

  if (
    card.symbol ||
    card.address
  ) {
    lines.push(
      '',
    );

    if (card.symbol) {
      lines.push(
        `<b>${escapeHtml(
          card.symbol,
        )}</b>`,
      );
    }

    if (card.address) {
      lines.push(
        `<code>${escapeHtml(
          compactAddress(
            card.address,
          ),
        )}</code>`,
      );
    }
  }

  const summary =
    compactMetricLines(
      card,
    );

  if (
    summary.length >
    0
  ) {
    lines.push(
      '',
      ...summary,
    );
  }

  lines.push(
    ...compactEvidenceLines(
      card,
    ),
  );

  if (
    card.verdictTitle ||
    card.verdict
  ) {
    lines.push(
      '',
      '🧠 <b>AlphaOS</b>',
    );

    if (
      card.verdictTitle
    ) {
      lines.push(
        `<b>${escapeHtml(
          card.verdictTitle,
        )}</b>`,
      );
    }

    if (
      card.verdict
    ) {
      lines.push(
        escapeHtml(
          card.verdict,
        ),
      );
    }
  }

  /*
   * Keep Telegram alerts actionable.
   * Research history and engine bookkeeping
   * remain in Alpha Memory rather than being
   * exposed in every notification.
   */
  lines.push(
    '',
    '<i>Verify live market conditions before acting.</i>',
  );

  return lines.join(
    '\n',
  );
}
