import type { Investigation } from '../models/investigation.js';
import {
  buildAlphaAlert,
  formatUsd,
} from '../ui/alphaAlert/index.js';

type AlertSection = {
  title: string;
  icon: string;
  metrics?: Array<{
    label: string;
    value: string | number;
  }>;
  items?: string[];
};

function tierTone(
  tier: Investigation['signal']['tier'],
): 'PREMIUM' | 'POSITIVE' | 'WATCH' {
  if (tier === 'P0') return 'PREMIUM';
  if (tier === 'P1') return 'POSITIVE';
  return 'WATCH';
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return 'Not available';
  }

  return new Intl.NumberFormat('en-GB').format(value);
}

function formatRatio(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return 'Not available';
  }

  return `${value.toFixed(2)}x`;
}

function formatRisk(
  level: string,
  score: number,
): string {
  const cleanLevel =
    level?.trim().toUpperCase() || 'UNKNOWN';

  if (!Number.isFinite(score)) {
    return cleanLevel;
  }

  return `${cleanLevel} · ${Math.round(score)}/100`;
}

function verdictHeading(
  investigation: Investigation,
): string {
  const verdict =
    investigation.ai.verdict
      ?.trim()
      .toUpperCase();

  if (verdict === 'STRONG BUY') {
    return '🔥 STRONG BUY';
  }

  if (verdict === 'BUY') {
    return '🟢 BUY';
  }

  if (
    verdict === 'EXIT' ||
    verdict === 'RISK EXIT'
  ) {
    return '🚨 RISK EXIT';
  }

  if (verdict === 'SCALP') {
    return '⚡ SCALP';
  }

  return '👀 WATCH';
}

function verdictMessage(
  investigation: Investigation,
): string {
  const verdict =
    investigation.ai.verdict
      ?.trim()
      .toUpperCase();

  if (verdict === 'STRONG BUY') {
    return 'High-conviction setup. Wait for confirmation and avoid chasing rapid price movement.';
  }

  if (verdict === 'BUY') {
    return 'Positive setup. Entry confirmation is recommended.';
  }

  if (
    verdict === 'EXIT' ||
    verdict === 'RISK EXIT'
  ) {
    return 'Risk has increased. Protect capital and review the position immediately.';
  }

  if (verdict === 'SCALP') {
    return 'Short-term setup only. Use strict risk control.';
  }

  return 'No entry yet. Wait for stronger confirmation.';
}

function cleanReason(
  reason: string,
): string | null {
  const value = reason.trim();

  if (!value) return null;

  const lower = value.toLowerCase();

  const hiddenInternalTerms = [
    'pending',
    'scanning',
    'enrichment',
    'processing',
    'analysis running',
    'monitoring confirmation signals',
  ];

  if (
    hiddenInternalTerms.some((term) =>
      lower.includes(term),
    )
  ) {
    return null;
  }

  if (
    value.startsWith('✅') ||
    value.startsWith('⚠️') ||
    value.startsWith('❌')
  ) {
    return value;
  }

  return `• ${value}`;
}

export function renderTelegramInvestigation(
  investigation: Investigation,
): string {
  const sections: AlertSection[] = [];

  sections.push({
    title: 'MARKET',
    icon: '📊',
    metrics: [
      {
        label: 'Market Cap',
        value: formatUsd(
          investigation.market.marketCap,
        ),
      },
      {
        label: 'Liquidity',
        value: formatUsd(
          investigation.market.liquidity,
        ),
      },
      {
        label: '5m Volume',
        value: formatUsd(
          investigation.market.volume5m,
        ),
      },
      {
        label: 'Buys / Sells',
        value:
          `${formatNumber(
            investigation.orderflow.buys5m,
          )} / ` +
          formatNumber(
            investigation.orderflow.sells5m,
          ),
      },
      {
        label: 'Buy Ratio',
        value: formatRatio(
          investigation.orderflow.buyRatio,
        ),
      },
      {
        label: 'Age',
        value:
          `${investigation.signal.ageMinutes}m`,
      },
    ],
  });

  const reasons = investigation.ai.reasons
    .map(cleanReason)
    .filter(
      (reason): reason is string =>
        reason !== null,
    )
    .slice(0, 4);

  if (reasons.length > 0) {
    sections.push({
      title: 'WHY',
      icon: '🧠',
      items: reasons,
    });
  }

  const riskMetrics: AlertSection['metrics'] =
    [];

  if (investigation.creator.wallet) {
    riskMetrics.push({
      label: 'Creator Score',
      value:
        `${Math.round(
          investigation.creator.score,
        )}/100`,
    });

    riskMetrics.push({
      label: 'Creator Launches',
      value: formatNumber(
        investigation.creator.launches,
      ),
    });

    if (
      investigation.creator.bestMarketCap > 0
    ) {
      riskMetrics.push({
        label: 'Best Launch',
        value: formatUsd(
          investigation.creator.bestMarketCap,
        ),
      });
    }
  }

  if (investigation.risk.holder.hasData) {
    riskMetrics.push({
      label: 'Holder Risk',
      value: formatRisk(
        investigation.risk.holder.level,
        investigation.risk.holder.score,
      ),
    });
  }

  if (investigation.risk.bundle.hasData) {
    riskMetrics.push({
      label: 'Bundle Risk',
      value: formatRisk(
        investigation.risk.bundle.level,
        investigation.risk.bundle.score,
      ),
    });
  }

  if (
    investigation.risk.knownBuyers > 0
  ) {
    riskMetrics.push({
      label: 'Known Buyers',
      value: formatNumber(
        investigation.risk.knownBuyers,
      ),
    });
  }

  riskMetrics.push({
    label: 'Overall Risk',
    value:
      investigation.ai.riskLevel
        ?.toUpperCase() || 'UNKNOWN',
  });

  sections.push({
    title: 'RISK',
    icon: '🛡',
    metrics: riskMetrics,
  });

  sections.push({
    title: 'PLAN',
    icon: '🎯',
    metrics: [
      {
        label: 'Recommendation',
        value:
          investigation.ai.verdict
            ?.toUpperCase() || 'WATCH',
      },
      {
        label: 'Confirmation',
        value:
          investigation.ai.verdict
            ?.toUpperCase() === 'WATCH'
            ? 'Required'
            : 'Recommended',
      },
    ],
  });

  return buildAlphaAlert({
    title: verdictHeading(investigation),

    subtitle:
      `${investigation.signal.status} · ` +
      investigation.signal.timingLabel,

    tone: tierTone(
      investigation.signal.tier,
    ),

    symbol:
      investigation.token.symbol,

    address:
      investigation.token.shortAddress,

    score:
      investigation.ai.finalScore,

    confidence:
      investigation.ai.confidence,

    risk:
      investigation.ai.riskLevel,

    status:
      investigation.signal.status,

    sections,

    verdictTitle:
      investigation.ai.verdict,

    verdict:
      verdictMessage(investigation),

    tracking:
      '5m · 15m · 30m · 1h · 6h · 24h',
  });
}