import { config } from "../config.js";
import {
  adminBuyToken,
  adminSellTokenPercentWithRetry,
} from "./adminTrading.js";
import {
  chooseBestPair,
  fetchPairs,
} from "../services/dexscreener.js";
import { saveClosedAutoTrade } from "./autoTradeStore.js";
import { sendTelegram } from "../services/telegram.js";
import {
  recordTradeOpen,
  recordTradeClose,
} from "./tradeAnalytics.js";
import { getAlphaSettings } from "../services/settingsService.js";
import {
  createPendingPosition,
  markBuyFailed,
  markBuyReconciliationRequired,
  markPositionOpen,
  updatePositionMarket,
  markSellRequested,
  markSellPending,
  markSellFailed,
  closePosition,
  restoreActivePositions,
} from "./positionManager.js";
import {
  evaluateEmergencyExit,
  type EmergencyExitReason,
} from "../services/emergencyExitManager.js";
import { buildExecutionNotification } from '../ui/alphaNotificationPresets.js';

let autoTradePaused = false;

const recentlyRejected = new Map<string, number>();
const REJECT_COOLDOWN_MS = 15 * 60 * 1000;

export function pauseAutoTrade() {
  autoTradePaused = true;
}

export function resumeAutoTrade() {
  autoTradePaused = false;
}

export function isAutoTradePaused() {
  return autoTradePaused;
}

type AutoTrade = {
  positionId: string;
  token: string;
  symbol: string;
  entryPrice: number;
  highestPrice: number;
  stopPrice: number;
  amountSol: number;

  initialLiquidityUsd: number | null;

  status: "open" | "closed";
  openedAt: number;
  mode: "paper" | "live";
  sellInProgress: boolean;

  stopBreachCount: number;
  stopFirstBreachedAt: number | null;
};

type ClosedAutoTrade = AutoTrade & {
  closedAt: number;
  finalRoi: number;
  pnlSol: number;
  exitValueSol: number;
};

const activeTrades = new Map<string, AutoTrade>();
const closedTrades: ClosedAutoTrade[] = [];

console.log("════════════════════════════════════");
console.log("🤖 AlphaOS Trading Engine");
console.log("Execution Mode : Supabase runtime setting");
console.log(
  `Admin Trading : ${
    config.adminTradingEnabled ? "Enabled" : "Disabled"
  }`,
);
console.log(
  `Private Key   : ${
    config.adminTradingPrivateKey
      ? "Loaded ✅"
      : "Missing ❌"
  }`,
);
console.log("════════════════════════════════════");

const POSITION_CHECK_INTERVAL_MS = 5_000;

let lastRunAt = 0;

export async function canStartNewTrade(
  token: string,
): Promise<boolean> {
  if (autoTradePaused) return false;
  if (activeTrades.has(token)) return false;

  const settings = await getAlphaSettings();

  if (!settings.adminAutoBuyEnabled) {
    return false;
  }

  if (
    activeTrades.size >=
    Math.max(1, settings.maxOpenPositions)
  ) {
    return false;
  }

  return true;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmtPrice(value: number) {
  if (value < 0.000001) return value.toExponential(2);
  if (value < 0.01) return value.toFixed(8);
  return value.toFixed(6);
}

function fmtSol(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(4)} SOL`;
}

function calcPnlSol(amountSol: number, roiPct: number) {
  return amountSol * (roiPct / 100);
}

function trailPercentForRoi(roiPct: number) {
  if (roiPct >= 100) return 0.1;
  if (roiPct >= 60) return 0.12;
  if (roiPct >= 30) return 0.15;
  return 0.2;
}

function protectedFloorRoiForPeak(
  peakRoiPct: number,
): number | null {
  /*
   * Once a trade proves itself, progressively protect
   * part of the move.
   *
   * Before +20%:
   *   Allow normal meme-token volatility.
   *
   * +20%:
   *   Never intentionally give the entire move back.
   *
   * Higher peaks progressively lock more profit.
   */

  if (peakRoiPct >= 100) return 50;
  if (peakRoiPct >= 75) return 35;
  if (peakRoiPct >= 50) return 20;
  if (peakRoiPct >= 30) return 10;
  if (peakRoiPct >= 20) return 0;

  return null;
}

async function fetchCurrentMarket(token: string) {
  const pairs = await fetchPairs(token);
  const pair: any = chooseBestPair(pairs);

  const price = Number(pair?.priceUsd ?? 0);
  const liquidityUsd = Number(pair?.liquidity?.usd ?? 0);

  const buys5m = Number(
    pair?.txns?.m5?.buys ?? 0,
  );

  const sells5m = Number(
    pair?.txns?.m5?.sells ?? 0,
  );

  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  return {
    price,
    liquidityUsd:
      Number.isFinite(liquidityUsd)
        ? liquidityUsd
        : 0,
    buys5m:
      Number.isFinite(buys5m)
        ? buys5m
        : 0,
    sells5m:
      Number.isFinite(sells5m)
        ? sells5m
        : 0,
  };
}

async function fetchCurrentPrice(token: string) {
  const market = await fetchCurrentMarket(token);

  return market?.price ?? null;
}

async function saveClosedTrade(args: {
  trade: AutoTrade;
  exitPrice: number;
  finalRoi: number;
  pnlSol: number;
  exitValueSol: number;
}) {
  const closedAt = Date.now();

  closedTrades.unshift({
    ...args.trade,
    closedAt,
    finalRoi: args.finalRoi,
    pnlSol: args.pnlSol,
    exitValueSol: args.exitValueSol,
  });

  if (closedTrades.length > 100) {
    closedTrades.length = 100;
  }

  await saveClosedAutoTrade({
    token: args.trade.token,
    symbol: args.trade.symbol,
    mode: args.trade.mode,
    amountSol: args.trade.amountSol,
    entryPrice: args.trade.entryPrice,
    highestPrice: args.trade.highestPrice,
    exitPrice: args.exitPrice,
    finalRoi: args.finalRoi,
    pnlSol: args.pnlSol,
    exitValueSol: args.exitValueSol,
    openedAt: args.trade.openedAt,
    closedAt,
  });
}

function sellButtons(token: string) {
  return [
    [
      { text: 'Sell 25%', callback_data: `AUTO_SELL_25_${token}` },
      { text: 'Sell 50%', callback_data: `AUTO_SELL_50_${token}` },
      { text: 'Sell 100%', callback_data: `AUTO_SELL_100_${token}` },
    ],
  ];
}

export async function startAdminAutoTrade(args: {
  token: string;
  symbol: string;
  entryPrice: number;
  amountSol?: number;
  initialLiquidityUsd?: number | null;
}) {
  const settings = await getAlphaSettings();

  console.log("========================================");
  console.log("[AutoTrade] START");

  console.log({
      token: args.token,
      symbol: args.symbol,

      adminAutoBuyEnabled: settings.adminAutoBuyEnabled,
      executionMode: settings.executionMode,
      maxOpenPositions: settings.maxOpenPositions,
      activeTrades: activeTrades.size,

      paused: autoTradePaused,

      adminTradingEnabled: config.adminTradingEnabled,
      privateKeyLoaded: !!config.adminTradingPrivateKey,
  });

  console.log("========================================");

  if (!settings.adminAutoBuyEnabled) {
    console.log("[AutoTrade] Auto-buy disabled. Alert only.", {
      token: args.token,
      symbol: args.symbol,
    });

    return;
  }

  if (autoTradePaused) {
  await sendTelegram(
    config.ownerChatId,
    buildExecutionNotification({
      state: 'PAUSED',
      symbol: args.symbol,
      address: args.token,
      reason: 'Signal skipped because auto trading is paused.',
    }),
  );
  return;
}

    if (activeTrades.has(args.token)) {
    return;
  }

  const maxOpenPositions = Math.max(
    1,
    Math.round(settings.maxOpenPositions),
  );

  if (activeTrades.size >= maxOpenPositions) {
    console.log(
      '[AutoTrade] Maximum open positions reached.',
      {
        token: args.token,
        symbol: args.symbol,
        openPositions: activeTrades.size,
        maxOpenPositions,
      },
    );

    return;
  }

  const rejectedAt = recentlyRejected.get(args.token);

  if (rejectedAt && Date.now() - rejectedAt < REJECT_COOLDOWN_MS) {
    return;
  }


    /*
      * Entry momentum has already been confirmed by main.ts.
      *
      * Do NOT run another timed confirmation here.
      * We only perform an immediate execution-time sanity check
      * so AlphaOS can act quickly after the signal is confirmed.
      */

      const latestSettings =
        await getAlphaSettings(true);

      if (!latestSettings.adminAutoBuyEnabled) {
        console.log(
          "[AutoTrade] Auto-buy disabled before execution.",
          {
            token: args.token,
            symbol: args.symbol,
          },
        );

        return;
      }

      if (autoTradePaused) {
        console.log(
          "[AutoTrade] Auto-buy paused before execution.",
          {
            token: args.token,
            symbol: args.symbol,
          },
        );

        return;
      }

      const executionMode =
        latestSettings.executionMode;

      const isPaperMode =
        executionMode === "paper";

      console.log(
        "[AutoTrade] Runtime execution mode resolved.",
        {
          token: args.token,
          symbol: args.symbol,
          executionMode,
        },
      );

      if (executionMode === "live") {
        if (!config.adminTradingEnabled) {
          await sendTelegram(
            config.ownerChatId,
            buildExecutionNotification({ state: 'FAILED', reason: 'Live trading is disabled by the admin safety control.' }),
          );

          return;
        }

        if (!config.adminTradingPrivateKey) {
          await sendTelegram(
            config.ownerChatId,
            buildExecutionNotification({ state: 'FAILED', reason: 'Live trading credentials are unavailable.' }),
          );

          return;
        }
      }

      /*
      * Obtain the freshest executable market price.
      *
      * This is NOT another confirmation window.
      * It happens immediately before execution.
      */
      const confirmedPrice =
        await fetchCurrentPrice(args.token);

      if (!confirmedPrice) {
        console.log(
          "[AutoTrade] Entry cancelled: current price unavailable.",
          {
            token: args.token,
            symbol: args.symbol,
          },
        );

        recentlyRejected.set(
          args.token,
          Date.now(),
        );

        return;
      }

      const maxEntryDipPercent =
        Math.max(
          0,
          latestSettings.maxEntryDipPercent,
        );

      const maxEntryPumpPercent =
        Math.max(
          0,
          latestSettings.maxEntryPumpPercent,
        );

      const priceMovePercent =
        ((confirmedPrice - args.entryPrice) /
          args.entryPrice) *
        100;

      const minimumConfirmPrice =
        args.entryPrice *
        (1 - maxEntryDipPercent / 100);

      const maximumConfirmPrice =
        args.entryPrice *
        (1 + maxEntryPumpPercent / 100);

      /*
      * This protects against a sudden price jump/drop occurring
      * between final momentum confirmation and actual execution.
      */
      if (confirmedPrice < minimumConfirmPrice) {
        console.log(
          "[AutoTrade] Entry cancelled: price weakened before execution.",
          {
            token: args.token,
            symbol: args.symbol,
            signalPrice: args.entryPrice,
            currentPrice: confirmedPrice,
            movePercent: priceMovePercent,
          },
        );

        recentlyRejected.set(
          args.token,
          Date.now(),
        );

        return;
      }

      if (confirmedPrice > maximumConfirmPrice) {
        console.log(
          "[AutoTrade] Entry cancelled: price extended before execution.",
          {
            token: args.token,
            symbol: args.symbol,
            signalPrice: args.entryPrice,
            currentPrice: confirmedPrice,
            movePercent: priceMovePercent,
          },
        );

        recentlyRejected.set(
          args.token,
          Date.now(),
        );

        return;
      }

    const amountSol =
    args.amountSol ??
    latestSettings.adminTradeAmountSol;

  let pendingPosition;

try {
  pendingPosition = await createPendingPosition({
    token: args.token,
    symbol: args.symbol,
    mode: executionMode,
    signalPrice: confirmedPrice,
    entrySolAmount: amountSol,
    aiRecommendation: 'BUY',
    aiCommentary:
      'AI entry approved and confirmation completed.',
  });
} catch (err) {
  console.error(
    '[PositionManager] Could not create pending position:',
    err,
  );

  await sendTelegram(
    config.ownerChatId,
    buildExecutionNotification({
      state: 'FAILED', symbol: args.symbol, address: args.token,
      reason: `Position creation failed: ${err instanceof Error ? err.message : String(err)}`,
    }),
  );

  return;
}

let trade: Awaited<ReturnType<typeof adminBuyToken>>;

try {
trade = isPaperMode
  ? {
      signature: 'paper-trade-simulation',
      quote: null,
      walletAddress: 'paper-wallet',
      requestedSolAmount: amountSol,
      submittedLamports: String(
        Math.floor(amountSol * 1_000_000_000),
      ),
      tokenBalanceBefore: '0',
      tokenBalanceAfter: '0',
      tokensReceivedRaw: '0',
      verified: true,
      balanceCheckFailed: false,
      reconciliationRequired: false,
    }
  : await adminBuyToken({
      outputMint: args.token,
      amountSol,
    });
} catch (err) {
  console.error('AUTO BUY FAILED FULL:', err);

  await markBuyFailed({
    positionId: pendingPosition.id,
    errorMessage:
      err instanceof Error ? err.message : String(err),
  });

  await sendTelegram(
    config.ownerChatId,
    buildExecutionNotification({
      state: 'FAILED', symbol: args.symbol, address: args.token,
      reason: err instanceof Error ? err.message : String(err),
    }),
  );

  return;
}

if (!trade.verified) {
  await markBuyReconciliationRequired({
    positionId: pendingPosition.id,
    buySignature: trade.signature,
    buyBeforeBalanceRaw: trade.tokenBalanceBefore,
    errorMessage:
      'Buy transaction was confirmed, but the received token balance could not be verified. Manual reconciliation is required.',
  });

  await sendTelegram(
    config.ownerChatId,
    buildExecutionNotification({
      state: 'FAILED', symbol: args.symbol, address: args.token,
      metrics: [{ label: 'Tx', value: trade.signature }],
      reason: 'Buy submitted, but the received balance could not be verified. Manual reconciliation is required; no retry will occur.',
    }),
  );

  return;
}

    const initialStopLossPercent = Math.max(
    0,
    latestSettings.initialStopLossPercent,
  );

  const position: AutoTrade = {
    positionId: pendingPosition.id,
    token: args.token,
    symbol: args.symbol,
    entryPrice: confirmedPrice,
    highestPrice: confirmedPrice,
    stopPrice:
      confirmedPrice *
      (1 - initialStopLossPercent / 100),
    amountSol,

    initialLiquidityUsd:
      args.initialLiquidityUsd ?? null,

    status: "open",
    openedAt: Date.now(),
    mode: executionMode,
    sellInProgress: false,

    stopBreachCount: 0,
    stopFirstBreachedAt: null,
  };

  const initialTokenAmount = Number(
  trade.tokensReceivedRaw,
);

if (
  !Number.isFinite(initialTokenAmount) ||
  initialTokenAmount < 0
) {
  await markBuyReconciliationRequired({
    positionId: pendingPosition.id,
    buySignature: trade.signature,
    buyBeforeBalanceRaw: trade.tokenBalanceBefore,
    errorMessage:
      `Invalid received token balance returned after buy: ${trade.tokensReceivedRaw}`,
  });

  await sendTelegram(
    config.ownerChatId,
    buildExecutionNotification({
      state: 'FAILED', symbol: args.symbol, address: args.token,
      metrics: [{ label: 'Tx', value: trade.signature }],
      reason: 'Buy succeeded, but the received token amount was invalid. Manual reconciliation is required.',
    }),
  );

  return;
}

await markPositionOpen({
  positionId: pendingPosition.id,
  entryPrice: confirmedPrice,
  initialTokenAmount,
  stopPrice: position.stopPrice,
  trailingStopPercent:
    initialStopLossPercent / 100,

  buySignature: trade.signature,
  buyBeforeBalanceRaw:
    trade.tokenBalanceBefore,
  buyAfterBalanceRaw:
    trade.tokenBalanceAfter,
});

activeTrades.set(args.token, position);

await recordTradeOpen({
  token: args.token,
  symbol: args.symbol,
  entryPrice: confirmedPrice,
  highestPrice: confirmedPrice,
});

  await sendTelegram(
    config.ownerChatId,
    buildExecutionNotification({
      state: 'EXECUTED', symbol: args.symbol, address: args.token,
      metrics: [
        { label: 'Mode', value: isPaperMode ? 'PAPER BUY' : 'LIVE BUY' },
        { label: 'Amount', value: `${amountSol.toFixed(4)} SOL` },
        { label: 'Entry', value: `$${fmtPrice(confirmedPrice)}` },
        { label: 'Stop', value: `$${fmtPrice(position.stopPrice)}` },
        { label: 'Tx', value: trade.signature },
      ],
      reason: 'Position opened and protection is active.',
    }),
    sellButtons(args.token)
  );
}

export async function manualCloseAutoTrade(token: string, percent: 25 | 50 | 100) {
  const trade = activeTrades.get(token);

  if (!trade || trade.status !== 'open') {
    return {
      ok: false,
      message: 'No active auto trade found for this token.',
    };
  }

  const currentPrice = await fetchCurrentPrice(token);

  if (!currentPrice) {
    return {
      ok: false,
      message: 'Could not fetch current price.',
    };
  }

  const roiNow = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
  const pnlSol = calcPnlSol(trade.amountSol, roiNow);
  const valueSol = trade.amountSol + pnlSol;

  const isPaperPosition = trade.mode === 'paper';

  const sell = isPaperPosition
    ? { signature: `paper-manual-sell-${percent}` }
    : await adminSellTokenPercentWithRetry({
        inputMint: token,
        percent,
      });

  if (percent === 100) {
    trade.status = 'closed';
    activeTrades.delete(token);

    await saveClosedTrade({
      trade,
      exitPrice: currentPrice,
      finalRoi: roiNow,
      pnlSol,
      exitValueSol: valueSol,
    });

    await recordTradeClose({
      token,
      exitPrice: currentPrice,
      highestPrice: trade.highestPrice,
      pnlPercent: roiNow,
    });
  }

  await sendTelegram(
    config.ownerChatId,
    buildExecutionNotification({
      state: 'EXECUTED', symbol: trade.symbol, address: token,
      metrics: [
        { label: 'Mode', value: isPaperPosition ? 'PAPER SELL' : 'LIVE SELL' },
        { label: 'Sold', value: `${percent}%` },
        { label: 'Price', value: `$${fmtPrice(currentPrice)}` },
        { label: 'ROI', value: `${roiNow.toFixed(1)}%` },
        { label: 'PnL', value: fmtSol(pnlSol) },
        { label: 'Tx', value: sell.signature },
      ],
      reason: 'Manual position reduction completed.',
    })
  );

  return {
    ok: true,
    message: `${isPaperPosition ? 'Paper' : 'Live'} manual sell ${percent}% complete.`,
  };
}

export async function runAutoTradeManager() {
  if (Date.now() - lastRunAt < POSITION_CHECK_INTERVAL_MS) return;
  lastRunAt = Date.now();
    const settings = await getAlphaSettings();

  for (const [token, trade] of activeTrades.entries()) {
    if (trade.status !== 'open') continue;

    try {
const market = await fetchCurrentMarket(token);

if (!market) {
  continue;
}

const currentPrice = market.price;

const roiNow =
  ((currentPrice - trade.entryPrice) /
    trade.entryPrice) *
  100;

const pnlSol =
  calcPnlSol(trade.amountSol, roiNow);

const valueSol =
  trade.amountSol + pnlSol;

const emergencyDecision = evaluateEmergencyExit({
  token,
  symbol: trade.symbol,

  entryPrice: trade.entryPrice,
  currentPrice,
  highestPrice: trade.highestPrice,
  stopPrice: trade.stopPrice,

  initialLiquidityUsd:
    trade.initialLiquidityUsd,

  currentLiquidityUsd:
    market.liquidityUsd,

  buys5m:
    market.buys5m,

  sells5m:
    market.sells5m,

  // These remain off until their data is reliable.
  holderProtectionEnabled: false,
  holderDataAvailable: false,
  bundleProtectionEnabled: false,
});

/*
 * Intelligent stop validation
 *
 * Paper mode:
 *   Ordinary stop breaches require two consecutive
 *   five-second readings below the stop.
 *
 * Live mode:
 *   Keep immediate stop execution until paper results
 *   prove that validation improves outcomes.
 */
const stopBreached =
  currentPrice <= trade.stopPrice;

const hardLossReached =
  roiNow <= -12;

const structuralEmergency =
  emergencyDecision.shouldExit &&
  emergencyDecision.reason !== "TRAILING_STOP";

let confirmedStopExit = false;

const peakRoi =
  ((trade.highestPrice -
    trade.entryPrice) /
    trade.entryPrice) *
  100;

const profitProtectionActive =
  peakRoi >= 20;

if (stopBreached) {
  trade.stopBreachCount += 1;

  if (trade.stopFirstBreachedAt == null) {
    trade.stopFirstBreachedAt = Date.now();
  }

  console.log("[RecoveryValidator] Stop breached.", {
    token,
    symbol: trade.symbol,
    mode: trade.mode,
    currentPrice,
    stopPrice: trade.stopPrice,
    roiNow,
    breachCount: trade.stopBreachCount,
    hardLossReached,
    structuralEmergency,
    emergencyReason: emergencyDecision.reason,
  });

  /*
   * Live positions retain the current immediate stop.
   * Paper positions test the two-reading validator.
   */
  confirmedStopExit =
    trade.mode === "live" ||
    profitProtectionActive ||
    trade.stopBreachCount >= 2;
} else if (trade.stopBreachCount > 0) {
  console.log("[RecoveryValidator] Price reclaimed stop.", {
    token,
    symbol: trade.symbol,
    currentPrice,
    stopPrice: trade.stopPrice,
    previousBreachCount: trade.stopBreachCount,
  });

  trade.stopBreachCount = 0;
  trade.stopFirstBreachedAt = null;
}

const shouldExitNow =
  hardLossReached ||
  structuralEmergency ||
  confirmedStopExit;

const exitReason: EmergencyExitReason =
  hardLossReached
    ? "HARD_STOP_LOSS"
    : structuralEmergency
      ? emergencyDecision.reason ?? "TRAILING_STOP"
      : "TRAILING_STOP";

console.log("[EmergencyExit] Position evaluated.", {
  token,
  symbol: trade.symbol,
  shouldExit: emergencyDecision.shouldExit,
  severity: emergencyDecision.severity,
  reason: emergencyDecision.reason,
  message: emergencyDecision.message,
  metrics: emergencyDecision.metrics,
});

      if (
        settings.trailingStopEnabled &&
        currentPrice > trade.highestPrice
      ) {
        trade.highestPrice = currentPrice;

        const highRoi =
  ((trade.highestPrice - trade.entryPrice) /
    trade.entryPrice) *
  100;

const trailPercent =
  trailPercentForRoi(highRoi);

const trailingStopPrice =
  trade.highestPrice *
  (1 - trailPercent);

const protectedFloorRoi =
  protectedFloorRoiForPeak(
    highRoi,
  );

const protectedFloorPrice =
  protectedFloorRoi == null
    ? null
    : trade.entryPrice *
      (1 + protectedFloorRoi / 100);

/*
 * Use whichever protection is stronger:
 *
 * 1. Normal dynamic trailing stop
 * 2. Profit floor earned by reaching a milestone
 */
trade.stopPrice =
  protectedFloorPrice == null
    ? trailingStopPrice
    : Math.max(
        trailingStopPrice,
        protectedFloorPrice,
      );

const protectedRoiPercent =
  ((trade.stopPrice - trade.entryPrice) /
    trade.entryPrice) *
  100;

await updatePositionMarket({
  positionId: trade.positionId,

  currentPrice,
  highestPrice: trade.highestPrice,
  stopPrice: trade.stopPrice,
  trailingStopPercent: trailPercent,

  currentRoiPercent: roiNow,
  peakRoiPercent: highRoi,
  protectedRoiPercent,

  unrealizedPnlSol: pnlSol,
  estimatedValueSol: valueSol,

  aiRecommendation: 'HOLD',
  aiCommentary:
    'Position reached a new high and the trailing stop was moved upward.',
});

console.log("[AutoTrade] Trailing stop updated.", {
  positionId: trade.positionId,
  token,
  symbol: trade.symbol,
  currentPrice,
  highestPrice: trade.highestPrice,
  stopPrice: trade.stopPrice,
  trailPercent,
  roiNow,
});
      }

      if (
        shouldExitNow &&
        !trade.sellInProgress
      ) {
  trade.sellInProgress = true;

  const isPaperPosition = trade.mode === "paper";

  console.log("[AutoTrade] Exit triggered.", {
    positionId: trade.positionId,
    token,
    symbol: trade.symbol,
    reason: exitReason,
    currentPrice,
    stopPrice: trade.stopPrice,
    entryPrice: trade.entryPrice,
    roiNow,
  });

  try {
    /*
     * Mark the database first so another process or restored
     * manager can see that an exit is already underway.
     */
    await markSellRequested({
      positionId: trade.positionId,
      percent: 100,
    });

    await markSellPending(trade.positionId);

    /*
     * Execute immediately.
     * Telegram is intentionally not called before this point.
     */
    const sell = isPaperPosition
      ? {
          signature: "paper-sell-simulation",
        }
      : await adminSellTokenPercentWithRetry({
          inputMint: token,
          percent: 100,
        });

    /*
     * The current implementation records the latest observed
     * market price as the exit price.
     *
     * Later, we will improve this by storing the actual execution
     * proceeds and immutable exit-price information.
     */
    await closePosition({
      positionId: trade.positionId,

      exitPrice: currentPrice,
      finalRoiPercent: roiNow,
      realisedPnlSol: pnlSol,

      sellSignature: sell.signature,

      beforeBalanceRaw: "unknown",
      afterBalanceRaw: "0",
    });

    trade.status = "closed";
    activeTrades.delete(token);

    await saveClosedTrade({
      trade,
      exitPrice: currentPrice,
      finalRoi: roiNow,
      pnlSol,
      exitValueSol: valueSol,
    });

    await recordTradeClose({
      token,
      exitPrice: currentPrice,
      highestPrice: trade.highestPrice,
      pnlPercent: roiNow,
    });

    console.log("[AutoTrade] Exit completed.", {
      positionId: trade.positionId,
      token,
      symbol: trade.symbol,
      reason: exitReason,
      signature: sell.signature,
      finalRoi: roiNow,
    });

    /*
     * Notify only after execution and database closure complete.
     */
    await sendTelegram(
      config.ownerChatId,
      buildExecutionNotification({
        state: 'EXECUTED', symbol: trade.symbol, address: token,
        metrics: [
          { label: 'Mode', value: isPaperPosition ? 'PAPER SELL' : 'LIVE SELL' },
          { label: 'Reason', value: exitReason.replace(/_/g, ' ') },
          { label: 'Exit', value: `$${fmtPrice(currentPrice)}` },
          { label: 'ROI', value: `${roiNow.toFixed(1)}%` },
          { label: 'PnL', value: fmtSol(pnlSol) },
          { label: 'Tx', value: sell.signature },
        ],
        reason: 'Position closed and execution recorded.',
      }),
    );
  } catch (sellError) {
    const errorMessage =
      sellError instanceof Error
        ? sellError.message
        : String(sellError);
        trade.sellInProgress = false;

    console.error("[AutoTrade] Exit failed.", {
      positionId: trade.positionId,
      token,
      symbol: trade.symbol,
      reason: exitReason,
      error: errorMessage,
    });

    try {
      await markSellFailed({
        positionId: trade.positionId,
        errorMessage,
      });
    } catch (positionError) {
      console.error(
        "[AutoTrade] Could not record failed sell:",
        positionError,
      );
    }

    /*
     * Allow the next monitoring cycle to retry.
     */
    trade.sellInProgress = false;

    await sendTelegram(
      config.ownerChatId,
      buildExecutionNotification({
        state: 'FAILED', symbol: trade.symbol, address: token,
        metrics: [
          { label: 'Reason', value: exitReason.replace(/_/g, ' ') },
          { label: 'Price', value: `$${fmtPrice(currentPrice)}` },
          { label: 'Stop', value: `$${fmtPrice(trade.stopPrice)}` },
        ],
        reason: `${errorMessage} AlphaOS will retry during the next position check.`,
      }),
    );
  }
}
    } catch (error) {
      trade.sellInProgress = false;

      console.error("[AutoTrade] Position check failed.", {
        token,
        symbol: trade.symbol,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });

      await sendTelegram(
        config.ownerChatId,
        buildExecutionNotification({
          state: 'FAILED', symbol: trade.symbol, address: token,
          reason: `Position check failed: ${error instanceof Error ? error.message : String(error)}`,
        }),
      );
    }
  }
}

export async function restoreOpenTrades() {
  const positions = await restoreActivePositions();

  for (const position of positions) {
    if (
      position.status !== "OPEN" &&
      position.status !== "PARTIAL_EXIT"
    ) {
      continue;
    }

    if (
      position.entryPrice == null ||
      position.highestPrice == null ||
      position.stopPrice == null
    ) {
      continue;
    }

    activeTrades.set(position.token, {
      positionId: position.id,
      token: position.token,
      symbol: position.symbol,
      entryPrice: position.entryPrice,
      highestPrice: position.highestPrice,
      stopPrice: position.stopPrice,
      amountSol: position.entrySolAmount,

      initialLiquidityUsd:
        position.liquidity ?? null,

      status: "open",
      openedAt: new Date(
        position.openedAt ?? position.createdAt,
      ).getTime(),
      mode: position.mode,
      sellInProgress: false,
      stopBreachCount: 0,
      stopFirstBreachedAt: null,
    });
  }

  console.log(
    `[AutoTrade] Restored ${activeTrades.size} active trade(s).`,
  );
}

export function getAutoTradeStats() {
  const total = closedTrades.length;
  const wins = closedTrades.filter((t) => t.finalRoi > 0).length;
  const losses = closedTrades.filter((t) => t.finalRoi <= 0).length;

  const totalRoi = closedTrades.reduce((sum, t) => sum + t.finalRoi, 0);
  const totalPnlSol = closedTrades.reduce((sum, t) => sum + t.pnlSol, 0);

  const avgRoi = total > 0 ? totalRoi / total : 0;
  const winRate = total > 0 ? (wins / total) * 100 : 0;

  const best = closedTrades.reduce<ClosedAutoTrade | null>(
    (bestTrade, trade) =>
      !bestTrade || trade.finalRoi > bestTrade.finalRoi ? trade : bestTrade,
    null
  );

  return {
    total,
    wins,
    losses,
    winRate,
    avgRoi,
    totalPnlSol,
    best,
    openTrades: [...activeTrades.values()],
    recentClosed: closedTrades.slice(0, 5),
  };
}
