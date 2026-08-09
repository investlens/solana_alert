import type {
  DexPair,
  RiskResult,
  TokenState,
} from '../types.js';

import {
  buildAlphaAlert,
  formatUsd,
} from './alphaAlert/index.js';

function formatRatio(
  buys: number,
  sells: number,
): string {
  if (sells <= 0) {
    return buys > 0
      ? `${buys.toFixed(0)}x`
      : 'Tracking';
  }

  return `${(buys / sells).toFixed(2)}x`;
}

function buildPositiveReasons(
  result: RiskResult,
  bucket: 'BUY' | 'HIGH_BUY' | 'IGNORE',
): string[] {
  const reasons: string[] = [];

  if (bucket === 'HIGH_BUY') {
    reasons.push(
      '✅ High-priority AlphaOS threshold reached',
    );
  }

  if (result.score >= 78) {
    reasons.push(
      `✅ AI score qualified at ${result.score}/100`,
    );
  }

  if (result.buys5m > result.sells5m) {
    reasons.push(
      `✅ Buyer pressure leads ${result.buys5m} to ${result.sells5m}`,
    );
  }

  if (result.liquidityUsd >= 10_000) {
    reasons.push(
      '✅ Liquidity cleared the quality threshold',
    );
  }

  if (result.volume5m >= 5_000) {
    reasons.push(
      '✅ Strong five-minute trading activity',
    );
  }

  for (const reason of result.checksGood ?? []) {
    if (
      reason &&
      reasons.length < 4
    ) {
      reasons.push(`✅ ${reason}`);
    }
  }

  return reasons.slice(0, 4);
}

function buildRiskItems(
  result: RiskResult,
): string[] {
  return [
    ...(result.checksWarn ?? []),
    ...(result.checksBad ?? []),
  ]
    .filter(Boolean)
    .slice(0, 2)
    .map((item) => `⚠️ ${item}`);
}

export function buildProAlertMessage(args: {
  pair: DexPair;
  result: RiskResult;
  state: TokenState;
  bucket: 'BUY' | 'HIGH_BUY' | 'IGNORE';
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

  const isPriority =
    bucket === 'HIGH_BUY';

  const reasons =
    buildPositiveReasons(
      result,
      bucket,
    );

  const risks =
    buildRiskItems(result);

  return buildAlphaAlert({
    access: 'PREMIUM',

    title: isPriority
      ? 'ALPHAOS HIGH BUY'
      : 'ALPHAOS BUY',

    subtitle:
      'AI momentum confirmation passed',

    tone: isPriority
      ? 'PREMIUM'
      : 'POSITIVE',

    symbol,
    name,
    address,

    score: result.score,
    confidence: result.score,

    risk:
      `${result.marketSafetyLabel ?? result.risk ?? 'Tracking'} · ` +
      `${result.marketSafetyScore}/100`,

    status: isPriority
      ? 'HIGH PRIORITY'
      : 'QUALIFIED',

    sections: [
      {
        title: 'WHY ALPHAOS SELECTED IT',
        icon: '🧠',
        items: reasons,
      },

      {
        title: 'MARKET SNAPSHOT',
        icon: '📊',
        metrics: [
          {
            label: 'Market Cap',
            value: formatUsd(
              result.marketCap ||
              result.fdv,
            ),
          },
          {
            label: 'Liquidity',
            value: formatUsd(
              result.liquidityUsd,
            ),
          },
          {
            label: '5m Volume',
            value: formatUsd(
              result.volume5m,
            ),
          },
          {
            label: 'Buy Ratio',
            value: formatRatio(
              result.buys5m,
              result.sells5m,
            ),
          },
          {
            label: 'Buys / Sells',
            value:
              `${result.buys5m} / ` +
              `${result.sells5m}`,
          },
          {
            label: 'Token Age',
            value:
              `${Math.floor(
                result.ageMin,
              )}m`,
          },
        ],
      },

      ...(risks.length > 0
        ? [
            {
              title: 'RISK NOTES',
              icon: '🛡',
              items: risks,
            },
          ]
        : []),
    ],

    verdictTitle: isPriority
      ? 'HIGH-CONFIDENCE SETUP'
      : 'QUALIFIED SETUP',

    verdict: isPriority
      ? 'AlphaOS found strong score, liquidity, volume and buyer-pressure alignment.'
      : 'AlphaOS confirmed the setup after evaluating score, liquidity, activity and momentum.',

    tracking:
      'ALPHA MEMORY + OUTCOME TRACKING ACTIVE',

    disclaimer:
      'AI-generated market intelligence. Always verify token, holder and creator risks before trading.',
  });
}