import type {
  DexPair,
  RiskResult,
  TokenState,
} from '../types.js';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatUsd(
  value?: number | null,
): string {
  if (
    value == null ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return 'Tracking';
  }

  if (value >= 1_000_000_000) {
    return `$${(
      value /
      1_000_000_000
    ).toFixed(2)}B`;
  }

  if (value >= 1_000_000) {
    return `$${(
      value /
      1_000_000
    ).toFixed(2)}M`;
  }

  if (value >= 1_000) {
    return `$${(
      value /
      1_000
    ).toFixed(1)}K`;
  }

  return `$${Math.round(value)}`;
}

function formatRatio(
  buys: number,
  sells: number,
): string {
  if (sells <= 0) {
    return buys > 0
      ? `${buys.toFixed(0)}x`
      : 'Tracking';
  }

  return `${(
    buys /
    sells
  ).toFixed(2)}x`;
}

function compactAddress(
  value?: string | null,
): string {
  const clean =
    String(value ?? '').trim();

  if (!clean) {
    return 'Tracking';
  }

  if (clean.length <= 14) {
    return clean;
  }

  return (
    clean.slice(0, 6) +
    '…' +
    clean.slice(-5)
  );
}

function riskLabel(
  result: RiskResult,
): string {
  const label =
    result.marketSafetyLabel ??
    result.risk ??
    'Tracking';

  const score =
    Number.isFinite(
      result.marketSafetyScore,
    )
      ? `${result.marketSafetyScore}/100`
      : null;

  return score
    ? `${label} · ${score}`
    : String(label);
}

function topWarning(
  result: RiskResult,
): string | null {
  const warning = [
    ...(result.checksBad ?? []),
    ...(result.checksWarn ?? []),
  ]
    .map((item) =>
      String(item ?? '').trim(),
    )
    .find(Boolean);

  return warning ?? null;
}

export function buildProAlertMessage(args: {
  pair: DexPair;
  result: RiskResult;
  state: TokenState;
  bucket:
    | 'BUY'
    | 'HIGH_BUY'
    | 'IGNORE';
}): string {
  const {
    pair,
    result,
    bucket,
  } = args;

  const symbol =
    pair.baseToken?.symbol ??
    'UNKNOWN';

  const name =
    pair.baseToken?.name ??
    symbol;

  const address =
    pair.baseToken?.address ??
    null;

  const highPriority =
    bucket === 'HIGH_BUY';

  const buyRatio =
    formatRatio(
      result.buys5m,
      result.sells5m,
    );

  const warning =
    topWarning(result);

  const lines: string[] = [];

  /*
   * ===================================================
   * ALPHAOS ACTION ALERT
   * ===================================================
   *
   * The user should understand this message in
   * approximately 2-3 seconds.
   *
   * Deep research belongs behind DETAILS / dashboard.
   */

  lines.push(
    highPriority
      ? '⚡ <b>ALPHAOS · HIGH CONVICTION</b>'
      : '🟢 <b>ALPHAOS · ENTRY WINDOW</b>',
  );

  lines.push('');

  lines.push(
    `<b>${escapeHtml(
      symbol,
    )}</b>${
      name !== symbol
        ? ` · ${escapeHtml(name)}`
        : ''
    }`,
  );

  if (address) {
    lines.push(
      `<code>${escapeHtml(
        compactAddress(address),
      )}</code>`,
    );
  }

  lines.push('');
  lines.push(
    highPriority
      ? '🔥 <b>ACTION: PRIORITY SETUP</b>'
      : '🎯 <b>ACTION: QUALIFIED SETUP</b>',
  );

  lines.push('');

  lines.push(
    `Alpha Score   <b>${Math.round(
      result.score,
    )}/100</b>`,
  );

  lines.push(
    `Momentum      <b>${
      result.buys5m >
      result.sells5m
        ? 'BUYERS LEADING ↗'
        : 'MIXED'
    }</b>`,
  );

  lines.push(
    `Buy Pressure  <b>${escapeHtml(
      buyRatio,
    )}</b>`,
  );

  lines.push(
    `Risk          <b>${escapeHtml(
      riskLabel(result),
    )}</b>`,
  );

  lines.push('');

  lines.push(
    `Market Cap    <b>${escapeHtml(
      formatUsd(
        result.marketCap ||
          result.fdv,
      ),
    )}</b>`,
  );

  lines.push(
    `Liquidity     <b>${escapeHtml(
      formatUsd(
        result.liquidityUsd,
      ),
    )}</b>`,
  );

  lines.push(
    `5m Volume     <b>${escapeHtml(
      formatUsd(
        result.volume5m,
      ),
    )}</b>`,
  );

  lines.push(
    `Age           <b>${Math.max(
      0,
      Math.floor(
        result.ageMin,
      ),
    )}m</b>`,
  );

  if (warning) {
    lines.push('');
    lines.push(
      `⚠️ <b>WATCH:</b> ${escapeHtml(
        warning,
      )}`,
    );
  }

  lines.push('');
  lines.push(
    highPriority
      ? '✦ <b>AlphaOS:</b> Strong alignment confirmed. Re-check price before entry.'
      : '✦ <b>AlphaOS:</b> Setup confirmed. Execute only while momentum remains intact.',
  );

  return lines.join('\n');
}
