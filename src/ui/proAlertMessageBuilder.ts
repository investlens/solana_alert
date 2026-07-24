import type {
  DexPair,
  RiskResult,
  TokenState,
} from '../types.js';

import {
  buildAlphaAlert,
  formatUsd,
} from './alphaAlert/index.js';

function ratio(
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

function verdict(
  result: RiskResult,
): {
  title: string;
  text: string;
} {
  if (result.score >= 82) {
    return {
      title: 'HIGH-PRIORITY INVESTIGATION',
      text:
        'Strong momentum and healthy early structure detected. Confirm holder and creator risk before acting.',
    };
  }

  if (result.score >= 72) {
    return {
      title: 'WORTH INVESTIGATING',
      text:
        'A qualified opportunity is forming. Entry timing and risk confirmation still matter.',
    };
  }

  return {
    title: 'MONITOR FOR CONFIRMATION',
    text:
      'The setup needs stronger evidence before it deserves priority.',
  };
}

function buildReasons(
  result: RiskResult,
): string[] {
  const reasons = result.checksGood
    .filter(Boolean)
    .slice(0, 3)
    .map((item) => `✅ ${item}`);

  if (reasons.length > 0) {
    return reasons;
  }

  return [
    '✅ Multi-factor market activity detected',
  ];
}

function buildRisks(
  result: RiskResult,
): string[] {
  return [
    ...result.checksWarn,
    ...result.checksBad,
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

  const assessment =
    verdict(result);

  const isPriority =
    bucket === 'HIGH_BUY';

  const reasons =
    buildReasons(result);

  const risks =
    buildRisks(result);

      return buildAlphaAlert({
    access: 'PREMIUM',

    title: isPriority
      ? 'AI DISCOVERY · PRIORITY'
      : 'AI DISCOVERY',

    subtitle:
      'Multi-factor opportunity detected',

    tone: isPriority
      ? 'PREMIUM'
      : 'POSITIVE',

    symbol,
    name,
    address,

    score: result.score,
    confidence: result.score,

    risk: String(
      result.risk ??
      'Tracking',
    ),

    status: isPriority
      ? 'PRIORITY REVIEW'
      : 'INVESTIGATE',

    sections: [
      {
        title: 'WHY ALPHAOS FLAGGED IT',
        icon: '🔎',
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
            value: ratio(
              result.buys5m,
              result.sells5m,
            ),
          },
        ],
      },

      ...(risks.length > 0
        ? [
            {
              title: 'RISKS TO VERIFY',
              icon: '⚠️',
              items: risks,
            },
          ]
        : []),
    ],

    verdictTitle:
      assessment.title,

    verdict:
      assessment.text,

    tracking:
      'ALPHA MEMORY TRACKING ACTIVE',

    disclaimer:
      'AI-generated intelligence for research purposes only. Always verify creator, holder and liquidity risk before trading.',
  });
}