import {
  config,
} from '../../config.js';

import {
  sendTelegram,
} from '../../services/telegram.js';

import {
  hasRobinhoodObservation,
  saveRobinhoodObservation,
  saveRobinhoodRejection,
} from './robinhoodObservationStore.js';

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
  scanPonsSellability,
} from './security/sellabilityScanner.js';

import {
  scanRobinhoodHolderRisk,
} from './security/holderRiskScanner.js';

const OBSERVER_INTERVAL_MS =
  60_000;

const MIN_LIQUIDITY_USD =
  2_500;

const MAX_ALERTS_PER_CYCLE =
  3;

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

function normalize(
  value: string,
): string {
  return value
    .trim()
    .toLowerCase();
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

function buildWatchMessage(args: {
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

  top1Pct:
    number | null;

  warnings:
    string[];
}): string {
  const {
    token,
    market,
  } = args;

  const symbol =
    escapeHtml(
      token.symbol ??
      market.symbol ??
      'UNKNOWN',
    );

  const name =
    escapeHtml(
      token.name ??
      market.name ??
      symbol,
    );

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

  return [
    '🟣 <b>ALPHAOS • ROBINHOOD EARLY WATCH</b>',
    '',
    `<b>${symbol}</b> · ${name}`,
    '',
    '🧭 <b>DISCOVERY</b>',
    `Source: <b>${token.source}</b>`,
    'Status: <b>VETTED EARLY OBSERVATION</b>',
    '',
    '🛡 <b>SECURITY</b>',
    `Contract: ✅ PASS · ${args.contractScore}/100`,
    `Admin indicators: ${
      args.adminPenalty > 0
        ? `⚠️ Penalty ${args.adminPenalty}`
        : '✅ No material indicator detected'
    }`,
    `Pool: ✅ VERIFIED`,
    `Exit route: ✅ ${escapeHtml(args.sellStatus)}`,
    `Exit impact: ${impactText}`,
    `Holder risk: ${
      args.holderRisk === 'HIGH'
        ? '⚠️'
        : '⚪'
    } ${escapeHtml(holderText)}`,
    '',
    '📊 <b>MARKET</b>',
    `Market Cap: ${formatUsd(market.marketCapUsd)}`,
    `Liquidity: ${formatUsd(market.liquidityUsd)}`,
    `Price: ${formatPrice(market.priceUsd)}`,
    `5m Volume: ${formatUsd(market.volume5mUsd)}`,
    `Buys / Sells: ${market.buys5m} / ${market.sells5m}`,
    '',
    '👥 <b>HOLDERS</b>',
    `Observed circulating wallets: ${args.holderCount}`,
    `Largest observed wallet: ${
      args.top1Pct == null
        ? 'Tracking'
        : `${args.top1Pct.toFixed(2)}%`
    }`,
    '',
    '⚠️ <b>NOTES</b>',
    warningLines,
    '',
    '🧠 AlphaOS is tracking this token.',
    '<b>No Robinhood trade has been opened.</b>',
    '',
    'EARLY DISCOVERY + VETTING ACTIVE',
    '',
    `<code>${token.tokenAddress}</code>`,
  ].join('\n');
}

async function evaluateCandidate(
  token:
    RobinhoodDiscoveredToken,
): Promise<boolean> {
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
  const isPons =
    hasSource(
      token,
      'PONS',
    );

  if (!isPons) {
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
    MIN_LIQUIDITY_USD
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

  const sellability =
    await scanPonsSellability(
      token.tokenAddress,
    );

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

      warnings,
    });

  const buttons = [
    [
      {
        text:
          '📊 Chart',

        url:
          market.chartUrl ??
          buildChartUrl(
            token.tokenAddress,
          ),
      },

      {
        text:
          '🔎 Explorer',

        url:
          buildExplorerUrl(
            token.tokenAddress,
          ),
      },
    ],
  ];

  const observationId =
  await saveRobinhoodObservation({
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

    priceAtAlert:
      market.priceUsd,

    marketCapAtAlert:
      market.marketCapUsd,

    liquidityAtAlert:
      market.liquidityUsd,

    securityScore:
      contractGate.security
        .score,

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
  });

if (!observationId) {
  console.error(
    '[RobinhoodObserver] Observation save failed. Telegram alert skipped.',
    token.tokenAddress,
  );

  return false;
}

  await sendTelegram(
    config.adminTelegramId,
    message,
    buttons,
  );

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
