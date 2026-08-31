import { renderAlphaNotification } from '../../ui/alphaNotification.js';
import { buildAlphaMarketActions } from '../../ui/alphaNotificationActions.js';
import { coreDecisionEvidenceMetrics, marketContextMetrics, normalizeCoreDecisionMetrics, normalizeNotificationMarketContext } from '../../ui/notificationMarketContext.js';
import { persistOrLoadAlphaSemanticEventRecord } from '../../services/alphaSemanticEventService.js';
import { deliverAlphaSemanticEvent } from '../../services/alphaSemanticDeliveryService.js';
import { buildPremiumTokenNotification, verifiedPairAge } from '../../ui/premiumTokenNotification.js';

import {
  startPostAlertDevWatch,
} from './security/devPostAlertWatcher.js';

import { scanRobinhoodDevTokenFlow } from './security/devTokenFlowScanner.js';

import {
  scanRobinhoodDexPaid,
  type RobinhoodDexPaidResult,
} from './security/dexPaidScanner.js';

import {
  hasRobinhoodObservation,
  saveRobinhoodObservation,
  saveRobinhoodRejection,
} from './robinhoodObservationStore.js';

import {
  scanRobinhoodDevMovement,
} from './security/devMovementScanner.js';

import {
  evaluateRobinhoodCreatorRisk,
} from './robinhoodCreatorRisk.js';

import {
  discoverRobinhoodEcosystem,
} from './discovery/aggregator.js';

import type {
  RobinhoodDiscoveredToken,
} from './discovery/types.js';

import {
  getRobinhoodMarketSnapshot,
} from './market.js';

import {
  runRobinhoodSecurityGate,
} from './security/securityGate.js';

import {
  scanRobinhoodAdminRisk,
} from './security/adminRiskScanner.js';

import {
  scanRobinhoodPoolSecurity,
} from './security/poolSecurityScanner.js';

import {
  scanRobinhoodSellability,
} from './security/sellabilityScanner.js';

import {
  scanRobinhoodHolderRisk,
} from './security/holderRiskScanner.js';

const OBSERVER_INTERVAL_MS =
  60_000;

const ROBINHOOD_OBSERVER_VERSION =
  'QUALITY_GATE_V2_2026_08_10';

/*
 * Robinhood Telegram quality gate.
 *
 * Tokens can still be discovered/tracked below these
 * levels, but they should not become Telegram EARLY WATCH
 * alerts until they have enough market quality.
 */
const MIN_TRACK_LIQUIDITY_USD =
  2_500;

const MIN_ALERT_LIQUIDITY_USD =
  5_000;

const MIN_ALERT_MARKET_CAP_USD =
  5_000;

const MAX_ALERT_MARKET_CAP_USD =
  50_000;

const MAX_ALERT_SELL_IMPACT_PERCENT =
  0.30;

const DEV_CONFIRMATION_DELAY_MS =
  10_000;

const MAX_ALERT_TOP1_PERCENT =
  15;

const MAX_ALERT_DEV_HOLDING_PERCENT =
  20;

const MAX_ALERTS_PER_CYCLE =
  3;
const MAX_DEX_PAID_CHECKS_PER_CYCLE = 6;

/*
 * In-memory dedupe for the first observation version.
 *
 * We will move this to Supabase once the alert
 * pipeline is proven.
 */
const seenTokens =
  new Set<string>();

let observerStarted =
  false;

let observerRunning =
  false;

let observerInterval:
  | ReturnType<typeof setInterval>
  | null = null;
let dexPaidCursor = 0;
const dexPaidEvidence = new Map<string, RobinhoodDexPaidResult>();

function normalize(
  value: string,
): string {
  return value
    .trim()
    .toLowerCase();
}

function sleep(
  ms: number,
): Promise<void> {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        ms,
      );
    },
  );
}

function escapeHtml(
  value: string,
): string {
  return value
    .replace(
      /&/g,
      '&amp;',
    )
    .replace(
      /</g,
      '&lt;',
    )
    .replace(
      />/g,
      '&gt;',
    );
}

function formatUsd(
  value:
    number | null | undefined,
): string {
  if (
    value == null ||
    !Number.isFinite(value)
  ) {
    return 'Tracking';
  }

  if (
    Math.abs(value) >=
    1_000_000
  ) {
    return (
      '$' +
      (
        value /
        1_000_000
      ).toFixed(2) +
      'M'
    );
  }

  if (
    Math.abs(value) >=
    1_000
  ) {
    return (
      '$' +
      (
        value /
        1_000
      ).toFixed(2) +
      'K'
    );
  }

  return (
    '$' +
    value.toFixed(2)
  );
}

function formatPrice(
  value:
    number | null | undefined,
): string {
  if (
    value == null ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return 'Tracking';
  }

  if (value >= 1) {
    return (
      '$' +
      value.toFixed(4)
    );
  }

  if (value >= 0.01) {
    return (
      '$' +
      value.toFixed(6)
    );
  }

  return (
    '$' +
    value.toPrecision(6)
  );
}

function hasSource(
  token:
    RobinhoodDiscoveredToken,
  source: string,
): boolean {
  return token.sources.some(
    (evidence) =>
      evidence.source ===
      source,
  );
}

function buildChartUrl(
  tokenAddress: string,
): string {
  return (
    'https://dexscreener.com/robinhood/' +
    tokenAddress
  );
}

function buildExplorerUrl(
  tokenAddress: string,
): string {
  return (
    'https://robinhoodchain.blockscout.com/token/' +
    tokenAddress
  );
}

export function buildWatchMessage(args: {
  token:
    RobinhoodDiscoveredToken;

  market:
    NonNullable<
      Awaited<
        ReturnType<
          typeof getRobinhoodMarketSnapshot
        >
      >
    >;

  contractScore: number;

  adminPenalty: number;

  sellStatus: string;

  sellImpact:
    number | null;

  holderRisk: string;

  holderCount: number;

  devHoldingPercent:
  number | null;

  burnedPercent?:
  number | null;

    devHoldingStatus:
    string;

    dexPaid:
    boolean | null;

    dexPaidStatus:
    string;

  top1Pct:
    number | null;

    creatorStatus:
  string | null;

creatorScore:
  number | null;

creatorLaunches:
  number;

creatorHit100k:
  number;

creatorHit500k:
  number;

creatorHit1m:
  number;

creatorBestPeakMarketCap:
  number;

  warnings:
    string[];


}): string {
  const {
    token,
    market,
  } = args;

  const symbol = token.symbol ?? market.symbol ?? 'UNKNOWN';

  const name = token.name ?? market.name ?? symbol;

  const holderText =
    args.holderCount < 5
      ? 'EARLY / LIMITED DATA'
      : args.holderRisk;

    

  const impactText =
    args.sellImpact == null
      ? 'Tracking'
      : `${args.sellImpact.toFixed(2)}%`;

  const warningLines =
    args.warnings.length > 0
      ? args.warnings
          .slice(0, 3)
          .map(
            (warning) =>
              `• ${escapeHtml(warning)}`,
          )
          .join('\n')
      : '• No major warning from completed checks';

    const creatorLines:
  string[] = [];


if (
  args.creatorStatus &&
  args.creatorStatus !==
    'UNKNOWN'
) {
  creatorLines.push(
    '',
  );

  creatorLines.push(
    '👤 <b>CREATOR INTELLIGENCE</b>',
  );

  creatorLines.push(
    `Status: <b>${escapeHtml(
      args.creatorStatus,
    )}</b>`,
  );

  if (
    args.creatorScore != null
  ) {
    creatorLines.push(
      `Creator Score: <b>${args.creatorScore}/100</b>`,
    );
  }

  creatorLines.push(
    `Previous launches: <b>${args.creatorLaunches}</b>`,
  );


  if (
    args.creatorHit1m > 0
  ) {
    creatorLines.push(
      `🔥 $1M+ launches: <b>${args.creatorHit1m}</b>`,
    );
  } else if (
    args.creatorHit500k > 0
  ) {
    creatorLines.push(
      `💎 $500K+ launches: <b>${args.creatorHit500k}</b>`,
    );
  } else if (
    args.creatorHit100k > 0
  ) {
    creatorLines.push(
      `🚀 $100K+ launches: <b>${args.creatorHit100k}</b>`,
    );
  }


  if (
    args.creatorBestPeakMarketCap >
    0
  ) {
    creatorLines.push(
      `Best previous MC: <b>${formatUsd(
        args.creatorBestPeakMarketCap,
      )}</b>`,
    );
  }
}

  const marketContext = normalizeNotificationMarketContext(market);
  const decisionEvidence = normalizeCoreDecisionMetrics({
    devHoldingPercent: args.devHoldingPercent,
    devHoldingEvidence: args.devHoldingPercent == null ? 'UNAVAILABLE' : 'VERIFIED',
    burnedPercent: args.burnedPercent,
    burnEvidence: args.burnedPercent == null ? 'UNAVAILABLE' : 'VERIFIED',
  });
  return renderAlphaNotification({
    category: 'market', severity: 'watch', state: 'WATCHING',
    symbol, subtitle: name, address: token.tokenAddress, risk: holderText,
    confidence: args.contractScore,
    metrics: [
      ...marketContextMetrics(marketContext),
      { label: 'Exit impact', value: impactText },
      { label: 'Creator', value: args.creatorStatus && args.creatorStatus !== 'UNKNOWN' ? `${args.creatorStatus}${args.creatorScore == null ? '' : ` · ${args.creatorScore}/100`}` : 'Data unavailable' },
    ],
    specialistMetrics: coreDecisionEvidenceMetrics(decisionEvidence),
    evidence: args.warnings,
    reason: 'Early market quality passed initial checks.',
    recommendedAction: 'Waiting for entry confirmation.',
    access: 'ADMIN',
  });
}

async function saveEvaluatedObservation(args: {
  token:
    RobinhoodDiscoveredToken;

  market:
    NonNullable<
      Awaited<
        ReturnType<
          typeof getRobinhoodMarketSnapshot
        >
      >
    >;

  contractScore: number;

  adminPenalty: number;

  sellStatus: string;

  sellImpactPercent:
    number | null;



  holderRisk: string;

  holderTop1Percent:
    number | null;

  circulatingHolderCount: number;

  deployerAddress:
    string | null;

  devHoldingPercent:
    number | null;

  devTokenBalance:
    number | null;

  dexPaid:
    boolean | null;

  dexPaidStatus:
    string | null;

  dexPaidTypes:
    string[];
    

  decision:
    'WATCH'
    | 'TRACK_ONLY';

  alertedAt?:
    string | null;
}) {
  return saveRobinhoodObservation({
    tokenAddress:
      args.token.tokenAddress,

    symbol:
      args.token.symbol ??
      args.market.symbol ??
      null,

    name:
      args.token.name ??
      args.market.name ??
      null,

    source:
      args.token.source,

    pairAddress:
      args.token.pairAddress ??
      args.market.pairAddress ??
      null,

    poolFee:
        args.token.source ===
        'ONCHAIN'
            ? (
                Number(
                args.token.metadata?.fee ??
                0,
                ) || null
            )
            : null,

    priceAtAlert:
      args.market.priceUsd,

    marketCapAtAlert:
      args.market.marketCapUsd,

    liquidityAtAlert:
      args.market.liquidityUsd,

    securityScore:
      args.contractScore,

    adminPenalty:
      args.adminPenalty,

    deployerAddress:
      args.deployerAddress,

    devHoldingPercent:
      args.devHoldingPercent,

    devTokenBalance:
      args.devTokenBalance,

    dexPaid:
      args.dexPaid,

    dexPaidStatus:
      args.dexPaidStatus,

    dexPaidTypes:
      args.dexPaidTypes,

    dexPaymentTimestamp:
      null,

    sellStatus:
      args.sellStatus,

    sellImpactPercent:
      args.sellImpactPercent,

    holderRisk:
      args.holderRisk,

    holderTop1Percent:
      args.holderTop1Percent,

    circulatingHolderCount:
      args.circulatingHolderCount,

    decision:
      args.decision,

    alertedAt:
      args.alertedAt ??
      null,
  });
}

async function evaluateCandidate(
  token:
    RobinhoodDiscoveredToken,
): Promise<boolean> {
  const dexPaid = dexPaidEvidence.get(normalize(token.tokenAddress)) ?? {
    tokenAddress: token.tokenAddress, dexPaid: null, status: 'UNKNOWN' as const,
    orderTypes: [], orderStatuses: [], latestPaymentTimestamp: null, warnings: [], scannedAt: Date.now(),
  };
  const tokenKey =
    normalize(
      token.tokenAddress,
    );

    const alreadyStored =
  await hasRobinhoodObservation(
    token.tokenAddress,
  );

if (alreadyStored) {
  seenTokens.add(
    tokenKey,
  );

  return false;
}

  /*
   * For the first live observer:
   *
   * Keep discovering every source,
   * but only notify a source whose actual
   * sell route has already been verified
   * by AlphaOS.
   */
  const isVerifiedSource =
  hasSource(
    token,
    'PONS',
  ) ||
  hasSource(
    token,
    'ONCHAIN',
  );


if (!isVerifiedSource) {
  return false;
}

  

  const contractGate =
    await runRobinhoodSecurityGate(
      token.tokenAddress,
    );

  if (
    !contractGate.allowed
  ) {
    console.log(
      '[RobinhoodObserver] Rejected by contract gate:',
      {
        token:
          token.tokenAddress,

        decision:
          contractGate.security
            .decision,

        blockers:
          contractGate.security
            .blockers,
      },
    );

    await saveRobinhoodRejection({
        tokenAddress:
            token.tokenAddress,

        symbol:
            token.symbol ??
            null,

        name:
            token.name ??
            null,

        source:
            token.source,

        pairAddress:
            token.pairAddress ??
            null,

        rejectionStage:
            'CONTRACT_GATE',

        rejectionReason:
            contractGate.security.blockers.length > 0
            ? contractGate.security.blockers.join(' | ')
            : contractGate.security.decision,

        securityScore:
            contractGate.security.score,
        });

    return false;
  }

  const adminRisk =
    await scanRobinhoodAdminRisk(
      token.tokenAddress,
    );

  const poolSecurity =
    await scanRobinhoodPoolSecurity({
      tokenAddress:
        token.tokenAddress,

      pairAddress:
        token.pairAddress,
    });

  if (
    poolSecurity.blockers.length >
    0
  ) {
    console.log(
      '[RobinhoodObserver] Rejected by pool gate:',
      {
        token:
          token.tokenAddress,

        blockers:
          poolSecurity.blockers,
      },
    );

    await saveRobinhoodRejection({
        tokenAddress:
            token.tokenAddress,

        symbol:
            token.symbol ??
            null,

        name:
            token.name ??
            null,

        source:
            token.source,

        pairAddress:
            token.pairAddress ??
            null,

        rejectionStage:
            'POOL_GATE',

        rejectionReason:
            poolSecurity.blockers.join(' | '),

        securityScore:
            contractGate.security.score,

        adminPenalty:
            adminRisk.scorePenalty,
        });

    return false;
  }

  if (
  poolSecurity
    .poolBytecodeExists ===
  false
) {
  await saveRobinhoodRejection({
    tokenAddress:
      token.tokenAddress,

    symbol:
      token.symbol ??
      null,

    name:
      token.name ??
      null,

    source:
      token.source,

    pairAddress:
      token.pairAddress ??
      null,

    rejectionStage:
      'POOL_GATE',

    rejectionReason:
      'POOL_BYTECODE_MISSING',

    securityScore:
      contractGate.security.score,

    adminPenalty:
      adminRisk.scorePenalty,
  });

  return false;
}

  const market =
    await getRobinhoodMarketSnapshot(
      token.tokenAddress,
      { priority: 'NORMAL', caller: 'robinhood_observer' },
    );

  /*
   * A launch can be discovered before the
   * market indexer catches up.
   *
   * Keep it eligible for a later cycle rather
   * than marking it permanently processed.
   */
  if (!market) {
    console.log(
      '[RobinhoodObserver] Waiting for market indexing:',
      token.tokenAddress,
    );

    return false;
  }

  if (
  market.liquidityUsd <
    MIN_TRACK_LIQUIDITY_USD
    ) {
    console.log(
      '[RobinhoodObserver] Waiting for liquidity:',
      {
        token:
          token.tokenAddress,

        liquidity:
          market.liquidityUsd,
      },
    );

    return false;
  }

  const poolFee =
    token.source ===
    'ONCHAIN'
        ? (
            Number(
            token.metadata?.fee ??
            0,
            ) || null
        )
        : null;


    const sellability =
    await scanRobinhoodSellability({
        tokenAddress:
        token.tokenAddress,

        source:
        token.source,

        poolFee,
    });

  if (
    !sellability.sellable ||
    sellability.status ===
      'NO_QUOTE' ||
    sellability.status ===
      'UNSUPPORTED' ||
    sellability.status ===
      'ERROR'
  ) {
    console.log(
      '[RobinhoodObserver] Rejected by sellability:',
      {
        token:
          token.tokenAddress,

        status:
          sellability.status,

        blockers:
          sellability.blockers,
      },
    );

    await saveRobinhoodRejection({
        tokenAddress:
            token.tokenAddress,

        symbol:
            token.symbol ??
            market.symbol ??
            null,

        name:
            token.name ??
            market.name ??
            null,

        source:
            token.source,

        pairAddress:
            token.pairAddress ??
            market.pairAddress ??
            null,

        rejectionStage:
            'SELLABILITY',

        rejectionReason:
            sellability.blockers.length > 0
            ? sellability.blockers.join(' | ')
            : sellability.status,

        priceAtDecision:
            market.priceUsd,

        marketCapAtDecision:
            market.marketCapUsd,

        liquidityAtDecision:
            market.liquidityUsd,

        securityScore:
            contractGate.security.score,

        adminPenalty:
            adminRisk.scorePenalty,

        sellStatus:
            sellability.status,

        sellImpactPercent:
            sellability.estimatedImpactPercent,
        });

    return false;
  }

  /*
   * HIGH_IMPACT remains observation-only.
   * We don't notify it as vetted tonight.
   */
  if (
    sellability.status ===
    'HIGH_IMPACT'
  ) {
    console.log(
      '[RobinhoodObserver] Rejected for high exit impact:',
      token.tokenAddress,
    );

    await saveRobinhoodRejection({
        tokenAddress:
            token.tokenAddress,

        symbol:
            token.symbol ??
            market.symbol ??
            null,

        name:
            token.name ??
            market.name ??
            null,

        source:
            token.source,

        pairAddress:
            token.pairAddress ??
            market.pairAddress ??
            null,

        rejectionStage:
            'EXIT_IMPACT',

        rejectionReason:
            'HIGH_EXIT_IMPACT',

        priceAtDecision:
            market.priceUsd,

        marketCapAtDecision:
            market.marketCapUsd,

        liquidityAtDecision:
            market.liquidityUsd,

        securityScore:
            contractGate.security.score,

        adminPenalty:
            adminRisk.scorePenalty,

        sellStatus:
            sellability.status,

        sellImpactPercent:
            sellability.estimatedImpactPercent,
        });

    return false;
  }

  const holderRisk =
    await scanRobinhoodHolderRisk(
      token.tokenAddress,
      {
        poolAddress:
          token.pairAddress,
      },
    );

  if (
    holderRisk
      .concentrationRisk ===
    'HIGH'
  ) {
    console.log(
      '[RobinhoodObserver] Rejected by holder concentration:',
      {
        token:
          token.tokenAddress,

        top1:
          holderRisk.top1Pct,

        top5:
          holderRisk.top5Pct,
      },
    );

    await saveRobinhoodRejection({
        tokenAddress:
            token.tokenAddress,

        symbol:
            token.symbol ??
            market.symbol ??
            null,

        name:
            token.name ??
            market.name ??
            null,

        source:
            token.source,

        pairAddress:
            token.pairAddress ??
            market.pairAddress ??
            null,

        rejectionStage:
            'HOLDER_CONCENTRATION',

        rejectionReason:
            'HIGH_HOLDER_CONCENTRATION',

        priceAtDecision:
            market.priceUsd,

        marketCapAtDecision:
            market.marketCapUsd,

        liquidityAtDecision:
            market.liquidityUsd,

        securityScore:
            contractGate.security.score,

        adminPenalty:
            adminRisk.scorePenalty,

        sellStatus:
            sellability.status,

        sellImpactPercent:
            sellability.estimatedImpactPercent,

        holderRisk:
            holderRisk.concentrationRisk,

        holderTop1Percent:
            holderRisk.top1Pct,

        circulatingHolderCount:
            holderRisk.circulatingHolderCountObserved,
        });

    return false;
  }

  const devHolding = await scanRobinhoodDevTokenFlow(token.tokenAddress);


const creatorRisk =
  await evaluateRobinhoodCreatorRisk(
    devHolding.deployerAddress,
  );

if (
  creatorRisk?.status ===
    'SERIAL_DUMPER' &&
  creatorRisk.suppressAlert
) {
  console.log(
    '[RobinhoodObserver] Silent - serial dumper creator:',
    {
      symbol:
        token.symbol ??
        market.symbol,

      token:
        token.tokenAddress,

      creator:
        creatorRisk.creatorWallet,

      launches:
        creatorRisk.launches,

      catastrophicCrashes:
        creatorRisk.catastrophicCrashes,

      catastrophicRate:
        Number(
          creatorRisk
            .catastrophicRatePercent
            .toFixed(2),
        ),

      hit50k:
        creatorRisk.hit50k,

      status:
        creatorRisk.status,
    },
  );


  await saveEvaluatedObservation({
    token,
    market,

    contractScore:
      contractGate.security.score,

    adminPenalty:
      adminRisk.scorePenalty,

    sellStatus:
      sellability.status,

    sellImpactPercent:
      sellability.estimatedImpactPercent,

    holderRisk:
      holderRisk.concentrationRisk,

    holderTop1Percent:
      holderRisk.top1Pct,

    circulatingHolderCount:
      holderRisk
        .circulatingHolderCountObserved,

    deployerAddress:
      devHolding.deployerAddress,

    devHoldingPercent:
      devHolding.devHoldingPercent,

    devTokenBalance:
      devHolding.devTokenBalance,

    dexPaid:
      dexPaid.dexPaid,

    dexPaidStatus:
      dexPaid.status,

    dexPaidTypes:
      dexPaid.orderTypes,

    decision:
      'TRACK_ONLY',
  });


  seenTokens.add(
    tokenKey,
  );

  return false;
}


/*
 * TELEGRAM QUALITY FILTERS START HERE
 */

if (
  market.liquidityUsd <
  MIN_ALERT_LIQUIDITY_USD
) {
  console.log(
    '[RobinhoodObserver] Silent - liquidity below alert floor:',
    {
      symbol:
        token.symbol ??
        market.symbol,

      token:
        token.tokenAddress,

      liquidity:
        market.liquidityUsd,
    },
  );

  await saveEvaluatedObservation({
    token,
    market,

    contractScore:
      contractGate.security.score,

    adminPenalty:
      adminRisk.scorePenalty,

    sellStatus:
      sellability.status,

    sellImpactPercent:
      sellability.estimatedImpactPercent,

    holderRisk:
      holderRisk.concentrationRisk,

    holderTop1Percent:
      holderRisk.top1Pct,

    circulatingHolderCount:
      holderRisk.circulatingHolderCountObserved,

    deployerAddress:
      devHolding.deployerAddress,

    devHoldingPercent:
      devHolding.devHoldingPercent,

    devTokenBalance:
      devHolding.devTokenBalance,

    dexPaid:
      dexPaid.dexPaid,

    dexPaidStatus:
      dexPaid.status,

    dexPaidTypes:
      dexPaid.orderTypes,

    decision:
      'TRACK_ONLY',
  });

  seenTokens.add(
    tokenKey,
  );

  return false;
}


/*
 * Your market-cap filter goes next
 */

if (
  market.marketCapUsd <
  MIN_ALERT_MARKET_CAP_USD
) {
  console.log(
    '[RobinhoodObserver] Silent - market cap below alert floor:',
    {
      symbol:
        token.symbol ??
        market.symbol,

      token:
        token.tokenAddress,

      marketCap:
        market.marketCapUsd,
    },
  );

  await saveEvaluatedObservation({
    token,
    market,

    contractScore:
      contractGate.security.score,

    adminPenalty:
      adminRisk.scorePenalty,

    sellStatus:
      sellability.status,

    sellImpactPercent:
      sellability.estimatedImpactPercent,

    holderRisk:
      holderRisk.concentrationRisk,

    holderTop1Percent:
      holderRisk.top1Pct,

    circulatingHolderCount:
      holderRisk.circulatingHolderCountObserved,

    deployerAddress:
      devHolding.deployerAddress,

    devHoldingPercent:
      devHolding.devHoldingPercent,

    devTokenBalance:
      devHolding.devTokenBalance,

    dexPaid:
      dexPaid.dexPaid,

    dexPaidStatus:
      dexPaid.status,

    dexPaidTypes:
      dexPaid.orderTypes,

    decision:
      'TRACK_ONLY',
  });

  seenTokens.add(
    tokenKey,
  );

  return false;
}


if (
  market.marketCapUsd >
  MAX_ALERT_MARKET_CAP_USD
) {
  console.log(
    '[RobinhoodObserver] Silent - market cap above alert ceiling:',
    {
      symbol:
        token.symbol ??
        market.symbol,

      token:
        token.tokenAddress,

      marketCap:
        market.marketCapUsd,
    },
  );

  await saveEvaluatedObservation({
    token,
    market,

    contractScore:
      contractGate.security.score,

    adminPenalty:
      adminRisk.scorePenalty,

    sellStatus:
      sellability.status,

    sellImpactPercent:
      sellability.estimatedImpactPercent,

    holderRisk:
      holderRisk.concentrationRisk,

    holderTop1Percent:
      holderRisk.top1Pct,

    circulatingHolderCount:
      holderRisk.circulatingHolderCountObserved,

    deployerAddress:
      devHolding.deployerAddress,

    devHoldingPercent:
      devHolding.devHoldingPercent,

    devTokenBalance:
      devHolding.devTokenBalance,

    dexPaid:
      dexPaid.dexPaid,

    dexPaidStatus:
      dexPaid.status,

    dexPaidTypes:
      dexPaid.orderTypes,

    decision:
      'TRACK_ONLY',
  });

  seenTokens.add(
    tokenKey,
  );

  return false;
}

if (
  sellability.estimatedImpactPercent != null &&
  sellability.estimatedImpactPercent >
    MAX_ALERT_SELL_IMPACT_PERCENT
) {
  console.log(
    '[RobinhoodObserver] Silent - exit impact above alert threshold:',
    {
      symbol:
        token.symbol ??
        market.symbol,

      token:
        token.tokenAddress,

      sellImpact:
        sellability.estimatedImpactPercent,
    },
  );

  await saveEvaluatedObservation({
    token,
    market,

    contractScore:
      contractGate.security.score,

    adminPenalty:
      adminRisk.scorePenalty,

    sellStatus:
      sellability.status,

    sellImpactPercent:
      sellability.estimatedImpactPercent,

    holderRisk:
      holderRisk.concentrationRisk,

    holderTop1Percent:
      holderRisk.top1Pct,

    circulatingHolderCount:
      holderRisk.circulatingHolderCountObserved,

    deployerAddress:
      devHolding.deployerAddress,

    devHoldingPercent:
      devHolding.devHoldingPercent,

    devTokenBalance:
      devHolding.devTokenBalance,

    dexPaid:
      dexPaid.dexPaid,

    dexPaidStatus:
      dexPaid.status,

    dexPaidTypes:
      dexPaid.orderTypes,

    decision:
      'TRACK_ONLY',
  });

  seenTokens.add(
    tokenKey,
  );

  return false;
}

if (
  holderRisk.top1Pct != null &&
  holderRisk.top1Pct >
    MAX_ALERT_TOP1_PERCENT
) {
  console.log(
    '[RobinhoodObserver] Silent - top holder above alert threshold:',
    {
      symbol:
        token.symbol ??
        market.symbol,

      token:
        token.tokenAddress,

      top1:
        holderRisk.top1Pct,
    },
  );

  await saveEvaluatedObservation({
    token,
    market,

    contractScore:
      contractGate.security.score,

    adminPenalty:
      adminRisk.scorePenalty,

    sellStatus:
      sellability.status,

    sellImpactPercent:
      sellability.estimatedImpactPercent,

    holderRisk:
      holderRisk.concentrationRisk,

    holderTop1Percent:
      holderRisk.top1Pct,

    circulatingHolderCount:
      holderRisk.circulatingHolderCountObserved,

    deployerAddress:
      devHolding.deployerAddress,

    devHoldingPercent:
      devHolding.devHoldingPercent,

    devTokenBalance:
      devHolding.devTokenBalance,

    dexPaid:
      dexPaid.dexPaid,

    dexPaidStatus:
      dexPaid.status,

    dexPaidTypes:
      dexPaid.orderTypes,

    decision:
      'TRACK_ONLY',
  });

  seenTokens.add(
    tokenKey,
  );

  return false;
}

if (
  devHolding.devHoldingPercent != null &&
  devHolding.devHoldingPercent >
    MAX_ALERT_DEV_HOLDING_PERCENT
) {
  console.log(
    '[RobinhoodObserver] Silent - dev holding above alert threshold:',
    {
      symbol:
        token.symbol ??
        market.symbol,

      token:
        token.tokenAddress,

      devHolding:
        devHolding.devHoldingPercent,
    },
  );

  await saveEvaluatedObservation({
    token,
    market,

    contractScore:
      contractGate.security.score,

    adminPenalty:
      adminRisk.scorePenalty,

    sellStatus:
      sellability.status,

    sellImpactPercent:
      sellability.estimatedImpactPercent,

    holderRisk:
      holderRisk.concentrationRisk,

    holderTop1Percent:
      holderRisk.top1Pct,

    circulatingHolderCount:
      holderRisk.circulatingHolderCountObserved,

    deployerAddress:
      devHolding.deployerAddress,

    devHoldingPercent:
      devHolding.devHoldingPercent,

    devTokenBalance:
      devHolding.devTokenBalance,

    dexPaid:
      dexPaid.dexPaid,

    dexPaidStatus:
      dexPaid.status,

    dexPaidTypes:
      dexPaid.orderTypes,

    decision:
      'TRACK_ONLY',
  });

  seenTokens.add(
    tokenKey,
  );

  return false;
}

/*
 * TELEGRAM QUALITY FILTERS END HERE
 */


/*
 * FINAL DEV SAFETY CONFIRMATION
 *
 * At this point the token has passed the
 * normal Telegram quality filters and is
 * actually about to become an alert.
 *
 * Check dev movement once, wait 10 seconds,
 * then check again before notifying.
 */

const devMovementBefore =
  await scanRobinhoodDevMovement(
    token.tokenAddress,
  );


if (
  devMovementBefore.moved
) {
  console.log(
    '[RobinhoodObserver] Rejected - dev already moved tokens:',
    {
      symbol:
        token.symbol ??
        market.symbol,

      token:
        token.tokenAddress,

      status:
        devMovementBefore.status,

      transfers:
        devMovementBefore.transferCount,

      destinations:
        devMovementBefore.destinations,
    },
  );

  await saveRobinhoodRejection({
    tokenAddress:
      token.tokenAddress,

    symbol:
      token.symbol ??
      market.symbol ??
      null,

    name:
      token.name ??
      market.name ??
      null,

    source:
      token.source,

    pairAddress:
      token.pairAddress ??
      market.pairAddress ??
      null,

    rejectionStage:
      'DEV_MOVEMENT',

    rejectionReason:
      'DEV_MOVED_BEFORE_ALERT',

    priceAtDecision:
      market.priceUsd,

    marketCapAtDecision:
      market.marketCapUsd,

    liquidityAtDecision:
      market.liquidityUsd,

    securityScore:
      contractGate.security.score,

    adminPenalty:
      adminRisk.scorePenalty,

    sellStatus:
      sellability.status,

    sellImpactPercent:
      sellability.estimatedImpactPercent,

    holderRisk:
      holderRisk.concentrationRisk,

    holderTop1Percent:
      holderRisk.top1Pct,

    circulatingHolderCount:
      holderRisk.circulatingHolderCountObserved,
  });

  seenTokens.add(
    tokenKey,
  );

  return false;
}


console.log(
  '[RobinhoodObserver] Final dev confirmation - waiting 10 seconds:',
  {
    symbol:
      token.symbol ??
      market.symbol,

    token:
      token.tokenAddress,
  },
);


await sleep(
  DEV_CONFIRMATION_DELAY_MS,
);


const devMovementAfter =
  await scanRobinhoodDevMovement(
    token.tokenAddress,
  );


if (
  devMovementAfter.moved
) {
  console.log(
    '[RobinhoodObserver] Rejected - dev moved during confirmation window:',
    {
      symbol:
        token.symbol ??
        market.symbol,

      token:
        token.tokenAddress,

      status:
        devMovementAfter.status,

      transfers:
        devMovementAfter.transferCount,

      destinations:
        devMovementAfter.destinations,
    },
  );

  await saveRobinhoodRejection({
    tokenAddress:
      token.tokenAddress,

    symbol:
      token.symbol ??
      market.symbol ??
      null,

    name:
      token.name ??
      market.name ??
      null,

    source:
      token.source,

    pairAddress:
      token.pairAddress ??
      market.pairAddress ??
      null,

    rejectionStage:
      'DEV_MOVEMENT',

    rejectionReason:
      'DEV_MOVED_DURING_CONFIRMATION',

    priceAtDecision:
      market.priceUsd,

    marketCapAtDecision:
      market.marketCapUsd,

    liquidityAtDecision:
      market.liquidityUsd,

    securityScore:
      contractGate.security.score,

    adminPenalty:
      adminRisk.scorePenalty,

    sellStatus:
      sellability.status,

    sellImpactPercent:
      sellability.estimatedImpactPercent,

    holderRisk:
      holderRisk.concentrationRisk,

    holderTop1Percent:
      holderRisk.top1Pct,

    circulatingHolderCount:
      holderRisk.circulatingHolderCountObserved,
  });

  seenTokens.add(
    tokenKey,
  );

  return false;
}


console.log(
  '[RobinhoodObserver] Dev confirmation passed:',
  {
    symbol:
      token.symbol ??
      market.symbol,

    token:
      token.tokenAddress,

    devHolding:
      devHolding.devHoldingPercent,
  },
);


const warnings =
  [
    ...poolSecurity.warnings,
    ...sellability.warnings,
    ...holderRisk.warnings,
  ];

  const message =
    buildWatchMessage({
      token,

      market,

      contractScore:
        contractGate.security
          .score,

      adminPenalty:
        adminRisk.scorePenalty,

      sellStatus:
        sellability.status,

      sellImpact:
        sellability
          .estimatedImpactPercent,

      holderRisk:
        holderRisk
          .concentrationRisk,

      holderCount:
        holderRisk
          .circulatingHolderCountObserved,

      top1Pct:
        holderRisk.top1Pct,

        devHoldingPercent:
        devHolding.devHoldingPercent,

        devHoldingStatus:
        devHolding.evidenceStatus,

        dexPaid:
        dexPaid.dexPaid,

        dexPaidStatus:
        dexPaid.status,

            creatorStatus:
            creatorRisk?.status ??
            null,

            creatorScore:
            creatorRisk?.score ??
            null,

            creatorLaunches:
            creatorRisk?.launches ??
            0,

            creatorHit100k:
            creatorRisk?.hit100k ??
            0,

            creatorHit500k:
            creatorRisk?.hit500k ??
            0,

            creatorHit1m:
            creatorRisk?.hit1m ??
            0,

            creatorBestPeakMarketCap:
            creatorRisk?.bestPeakMarketCap ??
            0,

            warnings,
    });

  const buttons = buildAlphaMarketActions({
    chartUrl: buildChartUrl(token.tokenAddress),
    tokenUrl: buildExplorerUrl(token.tokenAddress),
  });

  const observationId =
  await saveEvaluatedObservation({
    token,
    market,

    contractScore:
      contractGate.security.score,

    adminPenalty:
      adminRisk.scorePenalty,

    sellStatus:
      sellability.status,

    sellImpactPercent:
      sellability
        .estimatedImpactPercent,

    holderRisk:
      holderRisk
        .concentrationRisk,

    holderTop1Percent:
      holderRisk.top1Pct,

    circulatingHolderCount:
      holderRisk
        .circulatingHolderCountObserved,

    deployerAddress:
      devHolding.deployerAddress,

    devHoldingPercent:
      devHolding.devHoldingPercent,

    devTokenBalance:
      devHolding.devTokenBalance,

    dexPaid:
      dexPaid.dexPaid,

    dexPaidStatus:
      dexPaid.status,

    dexPaidTypes:
      dexPaid.orderTypes,

    decision:
      'WATCH',

    alertedAt:
      new Date().toISOString(),
  });

if (!observationId) {
  console.error(
    '[RobinhoodObserver] Observation save failed. Telegram alert skipped.',
    token.tokenAddress,
  );

  return false;
}

  console.log('[RobinhoodObserver] Qualified launch retained as internal intelligence; no standalone launch Telegram.', {
    token: token.tokenAddress,
  });

  startPostAlertDevWatch({
  tokenAddress:
    token.tokenAddress,

  symbol:
    token.symbol ??
    market.symbol,
});

  seenTokens.add(
    tokenKey,
  );

  console.log(
    '[RobinhoodObserver] EARLY WATCH sent:',
    {
      symbol:
        token.symbol ??
        market.symbol,

      token:
        token.tokenAddress,

      source:
        token.source,

      liquidity:
        market.liquidityUsd,

      marketCap:
        market.marketCapUsd,

      sellImpact:
        sellability
          .estimatedImpactPercent,
    },
  );

  return true;
}

export async function processRobinhoodDexPaidSignal(token: RobinhoodDiscoveredToken): Promise<boolean> {
  const dexPaid = await scanRobinhoodDexPaid(token.tokenAddress);
  dexPaidEvidence.set(normalize(token.tokenAddress), dexPaid);
  if (dexPaid.dexPaid !== true || dexPaid.latestPaymentTimestamp == null) return false;
  const market = await getRobinhoodMarketSnapshot(token.tokenAddress, { priority: 'NORMAL',
    caller: 'robinhood_dex_paid_context', queueWaitTimeoutMs: 750 }).catch(() => null);
  const chartUrl = market?.chartUrl ?? (token.pairAddress
    ? `https://dexscreener.com/robinhood/${encodeURIComponent(token.pairAddress)}` : buildChartUrl(token.tokenAddress));
  const marketContext = normalizeNotificationMarketContext(market ? {
    symbol: market.symbol, name: market.name, address: token.tokenAddress, price: market.priceUsd,
    marketCap: market.marketCapUsd, fdv: market.fdvUsd, liquidity: market.liquidityUsd,
    volume5m: market.volume5mUsd, chartUrl,
  } : null, token.metadata, { symbol: token.symbol, name: token.name, address: token.tokenAddress, chartUrl });
  const evidence = normalizeCoreDecisionMetrics(token.metadata);
  const age = verifiedPairAge(market?.pairCreatedAt);
  const semanticEvent = await persistOrLoadAlphaSemanticEventRecord({
    identity: `${token.tokenAddress.toLowerCase()}:${dexPaid.latestPaymentTimestamp}`,
    type: 'DEX_PAID', assetId: token.tokenAddress, chain: 'robinhood', intelligenceState: 'FORMING',
    symbol: marketContext.symbol ?? token.symbol ?? null, rawSnapshot: { paymentTimestamp: dexPaid.latestPaymentTimestamp,
      orderTypes: dexPaid.orderTypes, orderStatuses: dexPaid.orderStatuses, chartUrl,
      price: marketContext.price, priceProvenance: market ? 'DEXSCREENER_VERIFIED_BASE_PAIR' : null,
      marketCap: marketContext.marketCap, fdv: marketContext.fdv, liquidity: marketContext.liquidity,
      volume5m: marketContext.volume5m, pairCreatedAt: market?.pairCreatedAt ?? null,
      devHoldingPercent: evidence.devHoldingPercent, devHoldingEvidence: evidence.devHoldingEvidence },
  });
  const result = await deliverAlphaSemanticEvent({ event: { id: semanticEvent.id,
    eventIdentity: semanticEvent.event_identity, type: 'DEX_PAID', assetId: token.tokenAddress, chain: 'robinhood' },
    message: buildPremiumTokenNotification({ state: 'DEX_PAID', symbol: marketContext.symbol, name: marketContext.name,
      address: token.tokenAddress, market: marketContext, evidence, age,
      insightTitle: 'VERIFIED EVENT', insight: ['A verified Dex visibility payment was detected.'],
      statusTitle: '💎 STATUS', status: 'Dex Paid confirmed · evaluate live market conditions.' }),
    buttons: buildAlphaMarketActions({ chartUrl, tokenUrl: buildExplorerUrl(token.tokenAddress),
      fullIntelCallback: `FI_RH_${token.tokenAddress}`, copyContractCallback: `COPY_CA_${token.tokenAddress}` }) });
  console.log('[RobinhoodObserver] DEX PAID semantic delivery:', { token: token.tokenAddress,
    paymentTimestamp: dexPaid.latestPaymentTimestamp, delivered: result.delivered, failed: result.failed });
  return true;
}

export async function processRobinhoodDexPaidDiscoverySlice(tokens: RobinhoodDiscoveredToken[]) {
  const candidates = tokens;
  if (!candidates.length) return { selected: 0, detected: 0, failed: 0 };
  const start = dexPaidCursor % candidates.length;
  const rotated = [...candidates.slice(start), ...candidates.slice(0, start)];
  const selected = rotated.slice(0, MAX_DEX_PAID_CHECKS_PER_CYCLE);
  dexPaidCursor = (start + selected.length) % candidates.length;
  let detected = 0, failed = 0;
  for (const token of selected) {
    try { detected += Number(await processRobinhoodDexPaidSignal(token)); }
    catch (error) { failed += 1; console.error('[RobinhoodObserver] DEX PAID processing failed:', {
      token: token.tokenAddress, reason: error instanceof Error ? error.message : String(error) }); }
  }
  return { selected: selected.length, detected, failed };
}

export async function refreshRobinhoodObserver():
  Promise<void> {
  if (observerRunning) {
    console.log(
      '[RobinhoodObserver] Previous cycle still running. Skipping.',
    );

    return;
  }

  observerRunning =
    true;

  try {
    console.log(
      '[RobinhoodObserver] Starting discovery cycle...',
    );

    const discovery =
      await discoverRobinhoodEcosystem(
        50,
      );

    dexPaidEvidence.clear();

    console.log(
      '[RobinhoodObserver] Discovery:',
      {
        raw:
          discovery.totalRaw,

        unique:
          discovery.totalUnique,

        sources:
          discovery.sources,
      },
    );

    const dexPaid = await processRobinhoodDexPaidDiscoverySlice(discovery.tokens);
    console.log('[RobinhoodObserver] DEX PAID cycle:', dexPaid);

    /*
     * On the first cycle, we DO evaluate current
     * PONS launches rather than silently seeding
     * everything. MAX_ALERTS_PER_CYCLE prevents
     * a Telegram flood.
     */
    let alertsSent =
      0;

    for (
      const token
      of discovery.tokens
    ) {
      if (
        alertsSent >=
        MAX_ALERTS_PER_CYCLE
      ) {
        break;
      }

      const key =
        normalize(
          token.tokenAddress,
        );

      if (
        seenTokens.has(key)
      ) {
        continue;
      }

      try {
        const sent =
          await evaluateCandidate(
            token,
          );

        if (sent) {
          alertsSent +=
            1;
        }
      } catch (error) {
        console.error(
          '[RobinhoodObserver] Candidate evaluation failed:',
          {
            token:
              token.tokenAddress,

            error:
              error instanceof Error
                ? error.message
                : String(error),
          },
        );
      }
    }

    console.log(
      '[RobinhoodObserver] Cycle complete:',
      {
        alertsSent,

        tracked:
          seenTokens.size,
      },
    );
  } catch (error) {
    console.error(
      '[RobinhoodObserver] Cycle failed:',
      error,
    );
  } finally {
    observerRunning =
      false;
  }
}

export function startRobinhoodObserver():
  void {
  if (observerStarted) {
    console.log(
      '[RobinhoodObserver] Already started.',
    );

    return;
  }

  observerStarted =
    true;

  console.log(
    `[RobinhoodObserver] Started. Interval: ${
      OBSERVER_INTERVAL_MS /
      1000
    } seconds.`,
  );

  console.log(
    '[RobinhoodObserver] Version:',
    ROBINHOOD_OBSERVER_VERSION,
    );

  void refreshRobinhoodObserver();

  observerInterval =
    setInterval(
      () => {
        void refreshRobinhoodObserver();
      },
      OBSERVER_INTERVAL_MS,
    );
}

export function stopRobinhoodObserver():
  void {
  if (
    observerInterval
  ) {
    clearInterval(
      observerInterval,
    );

    observerInterval =
      null;
  }

  observerStarted =
    false;

  console.log(
    '[RobinhoodObserver] Stopped.',
  );
}
