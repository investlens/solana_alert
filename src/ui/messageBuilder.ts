import { config } from '../config.js';

import type {
  DexPair,
  FreeTrialInfo,
  RiskResult,
  TokenState,
} from '../types.js';

import {
  fmtPrice,
} from '../utils/format.js';

import {
  buildAlphaAlert,
  formatUsd,
} from './alphaAlert/index.js';

function getActionBucket(
  result: RiskResult,
): 'BUY' | 'HIGH_BUY' {
  return (
    result.score >= 82 &&
    result.marketSafetyScore >= 70 &&
    result.liquidityUsd >= 8_000 &&
    result.volume5m >= 8_000 &&
    result.buys5m >= 100
  )
    ? 'HIGH_BUY'
    : 'BUY';
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

  return `${(buys / sells).toFixed(2)}x`;
}

function buildEvidence(
  result: RiskResult,
  bucket: 'BUY' | 'HIGH_BUY',
): string[] {
  const evidence: string[] = [];

  if (bucket === 'HIGH_BUY') {
    evidence.push(
      '✅ High-priority setup threshold reached',
    );
  }

  if (result.score >= 78) {
    evidence.push(
      `✅ AI score qualified at ${result.score}/100`,
    );
  }

  if (result.buys5m > result.sells5m) {
    evidence.push(
      '✅ Buyer pressure remains positive',
    );
  }

  if (result.liquidityUsd >= 10_000) {
    evidence.push(
      '✅ Liquidity quality threshold cleared',
    );
  }

  if (result.volume5m >= 5_000) {
    evidence.push(
      '✅ Strong recent trading activity',
    );
  }

  return evidence.slice(0, 4);
}

function buildAccessItems(args: {
  tier: 'OWNER' | 'PAID' | 'FREE';
  freeTrialInfo?: FreeTrialInfo;
}): string[] {
  const items: string[] = [];

  if (
    args.tier === 'FREE' &&
    args.freeTrialInfo
  ) {
    const trial =
      args.freeTrialInfo;

    if (trial.fastDelayActive) {
      items.push(
        `Trial alerts used: ${trial.used}/${trial.limit}`,
      );
    } else {
      items.push(
        'Free alerts are delayed · /upgrade',
      );
    }
  }

  if (config.sponsor.title) {
    items.push(
      `Partner: ${config.sponsor.title}`,
    );
  }

  return items;
}

export function buildMessage(args: {
  tier: 'OWNER' | 'PAID' | 'FREE';
  pair: DexPair;
  result: RiskResult;
  state: TokenState;
  freeTrialInfo?: FreeTrialInfo;
}): string {
  const {
    tier,
    pair,
    result,
    freeTrialInfo,
  } = args;

  const name =
    pair.baseToken?.name ||
    pair.baseToken?.symbol ||
    'Unknown';

  const symbol =
    pair.baseToken?.symbol ||
    name;

  const address =
    pair.baseToken?.address ??
    null;

  const bucket =
    getActionBucket(result);

  const isPriority =
    bucket === 'HIGH_BUY';

  const marketCap =
    result.marketCap > 0
      ? result.marketCap
      : result.fdv;

  const evidence =
    buildEvidence(
      result,
      bucket,
    );

  const accessItems =
    buildAccessItems({
      tier,
      freeTrialInfo,
    });

  return buildAlphaAlert({
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
        items: evidence,
      },

      {
        title: 'MARKET SNAPSHOT',
        icon: '📊',
        metrics: [
          {
            label: 'Market Cap',
            value: formatUsd(
              marketCap,
            ),
          },
          {
            label: 'Liquidity',
            value: formatUsd(
              result.liquidityUsd,
            ),
          },
          {
            label: 'Price',
            value: fmtPrice(
              result.currentPrice,
            ),
          },
          {
            label: 'Token Age',
            value:
              `${Math.floor(
                result.ageMin,
              )}m`,
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
        ],
      },

      ...(accessItems.length > 0
        ? [
            {
              title: 'ACCESS',
              icon: '🔐',
              items: accessItems,
            },
          ]
        : []),
    ],

    verdictTitle: isPriority
      ? 'HIGH-CONFIDENCE SETUP'
      : 'QUALIFIED SETUP',

    verdict: isPriority
      ? 'Strong score, market structure, liquidity and order-flow alignment detected.'
      : 'AlphaOS confirmed the opportunity after evaluating momentum and market quality.',

    tracking:
      'ALPHA MEMORY + OUTCOME TRACKING ACTIVE',

    disclaimer:
      'AI-generated market intelligence. Always verify token, holder and creator risks before trading.',
  });
}