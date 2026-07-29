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
  closePosition,
  restoreActivePositions,
} from "./positionManager.js";

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
  status: 'open' | 'closed';
  openedAt: number;
  mode: 'paper' | 'live';
  sellInProgress: boolean;
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

async function fetchCurrentPrice(token: string) {
  const pairs = await fetchPairs(token);
  const pair: any = chooseBestPair(pairs);
  const price = Number(pair?.priceUsd ?? 0);

  if (!Number.isFinite(price) || price <= 0) return null;
  return price;
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
}) {
  const settings = await getAlphaSettings();

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
    '⏸️ <b>AUTO TRADE PAUSED</b>\n\nSignal skipped because auto trading is paused.'
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


    const confirmationSeconds = Math.max(
    5,
    Math.round(settings.entryConfirmationSeconds),
  );

  const confirmationDelayMs =
    confirmationSeconds * 1_000;

  const maxEntryDipPercent = Math.max(
    0,
    settings.maxEntryDipPercent,
  );

  const maxEntryPumpPercent = Math.max(
    0,
    settings.maxEntryPumpPercent,
  );

  await sendTelegram(
    config.ownerChatId,
    [
      '⏳ <b>ENTRY STUDY ACTIVE</b>',
      '',
      `<b>${args.symbol}</b>`,
      `Signal Price: <b>$${fmtPrice(args.entryPrice)}</b>`,
      `Study Window: <b>${confirmationSeconds} seconds</b>`,
      '',
      'AlphaOS is checking whether the entry remains healthy.',
    ].join('\n'),
  );

  await sleep(confirmationDelayMs);

  /*
   * Re-check the setting after the study window.
   * This allows admin to disable auto-buy while a token
   * is being analysed.
   */

  const latestSettings = await getAlphaSettings(true);

if (!latestSettings.adminAutoBuyEnabled) {
  console.log(
    "[AutoTrade] Auto-buy disabled during entry study.",
    {
      token: args.token,
      symbol: args.symbol,
    },
  );

  return;
}

if (autoTradePaused) {
  console.log(
    "[AutoTrade] Auto-buy paused during entry study.",
    {
      token: args.token,
      symbol: args.symbol,
    },
  );

  return;
}

const executionMode = latestSettings.executionMode;
const isPaperMode = executionMode === "paper";

console.log("[AutoTrade] Runtime execution mode resolved.", {
  token: args.token,
  symbol: args.symbol,
  executionMode,
});

if (executionMode === "live") {
  if (!config.adminTradingEnabled) {
    await sendTelegram(
      config.ownerChatId,
      "❌ Live trading blocked.\n\nADMIN_TRADING_ENABLED is false.",
    );

    return;
  }

  if (!config.adminTradingPrivateKey) {
    await sendTelegram(
      config.ownerChatId,
      "❌ Live trading blocked.\n\nAdmin private key is missing.",
    );

    return;
  }
}

const confirmedPrice = await fetchCurrentPrice(args.token);

  if (!confirmedPrice) {
    await sendTelegram(
      config.ownerChatId,
      [
        '⚠️ <b>ENTRY CANCELLED</b>',
        '',
        `<b>${args.symbol}</b>`,
        'AlphaOS could not confirm the current price.',
        '',
        'No trade was opened.',
      ].join('\n'),
    );

    recentlyRejected.set(
      args.token,
      Date.now(),
    );

    return;
  }

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

  if (confirmedPrice < minimumConfirmPrice) {
    await sendTelegram(
      config.ownerChatId,
      [
        '❌ <b>ENTRY CANCELLED</b>',
        '',
        `<b>${args.symbol}</b>`,
        `Signal Price: <b>$${fmtPrice(args.entryPrice)}</b>`,
        `Current Price: <b>$${fmtPrice(confirmedPrice)}</b>`,
        `Move: <b>${priceMovePercent.toFixed(1)}%</b>`,
        '',
        'Reason: trend weakened during the entry study.',
        'No trade was opened.',
      ].join('\n'),
    );

    recentlyRejected.set(
      args.token,
      Date.now(),
    );

    return;
  }

  if (confirmedPrice > maximumConfirmPrice) {
    await sendTelegram(
      config.ownerChatId,
      [
        '❌ <b>ENTRY CANCELLED</b>',
        '',
        `<b>${args.symbol}</b>`,
        `Signal Price: <b>$${fmtPrice(args.entryPrice)}</b>`,
        `Current Price: <b>$${fmtPrice(confirmedPrice)}</b>`,
        `Move: <b>+${priceMovePercent.toFixed(1)}%</b>`,
        '',
        'Reason: price moved too quickly before entry.',
        'AlphaOS avoided chasing the pump.',
      ].join('\n'),
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
    [
      '❌ <b>POSITION CREATION FAILED</b>',
      '',
      `<b>${args.symbol}</b>`,
      `Token: <code>${args.token}</code>`,
      '',
      err instanceof Error ? err.message : String(err),
    ].join('\n'),
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
    [
      '❌ <b>AUTO BUY FAILED</b>',
      '',
      `<b>${args.symbol}</b>`,
      `Token: <code>${args.token}</code>`,
      '',
      err instanceof Error ? err.message : String(err),
    ].join('\n'),
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
    [
      '⚠️ <b>BUY RECONCILIATION REQUIRED</b>',
      '',
      `<b>${args.symbol}</b>`,
      `Token: <code>${args.token}</code>`,
      '',
      'The transaction was submitted successfully, but AlphaOS could not verify the received token balance.',
      '',
      'The bot will not attempt another buy.',
      `Tx: <code>${trade.signature}</code>`,
    ].join('\n'),
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
    status: 'open',
    openedAt: Date.now(),
    mode: executionMode,
    sellInProgress: false,
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
    [
      '⚠️ <b>BUY RECONCILIATION REQUIRED</b>',
      '',
      `<b>${args.symbol}</b>`,
      `Token: <code>${args.token}</code>`,
      '',
      'The transaction succeeded, but the received token amount was invalid.',
      `Tx: <code>${trade.signature}</code>`,
    ].join('\n'),
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
    [
      isPaperMode
        ? "🧪 <b>PAPER AUTO BUY STARTED</b>"
        : "🤖 <b>AUTO BUY EXECUTED</b>",
      '',
      `<b>${args.symbol}</b>`,
      `Amount: <b>${amountSol.toFixed(4)} SOL</b>`,
      `Entry Price: <b>$${fmtPrice(confirmedPrice)}</b>`,
      `Initial Stop: <b>$${fmtPrice(position.stopPrice)}</b>`,
      `Initial Stop Width: <b>${initialStopLossPercent}%</b>`,
      '',
      'AlphaOS is now protecting this position.',
      `Tx: <code>${trade.signature}</code>`,
    ].join('\n'),
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
    [
      isPaperPosition
      ? '🧪 <b>PAPER MANUAL SELL</b>'
      : '✅ <b>MANUAL SELL EXECUTED</b>',
      '',
      `<b>${trade.symbol}</b>`,
      `Sold: <b>${percent}%</b>`,
      `Current Price: <b>$${fmtPrice(currentPrice)}</b>`,
      `ROI Now: <b>${roiNow.toFixed(1)}%</b>`,
      `Paper PnL: <b>${fmtSol(pnlSol)}</b>`,
      `Paper Value: <b>${valueSol.toFixed(4)} SOL</b>`,
      `Tx: <code>${sell.signature}</code>`,
    ].join('\n')
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
      const currentPrice = await fetchCurrentPrice(token);
      if (!currentPrice) continue;

      const roiNow = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
      const pnlSol = calcPnlSol(trade.amountSol, roiNow);
      const valueSol = trade.amountSol + pnlSol;

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

trade.stopPrice =
  trade.highestPrice * (1 - trailPercent);

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

await sendTelegram(
          config.ownerChatId,
          [
            '📈 <b>TRAILING STOP MOVED UP</b>',
            '',
            `<b>${trade.symbol}</b>`,
            `Current Price: <b>$${fmtPrice(currentPrice)}</b>`,
            `Highest Price: <b>$${fmtPrice(trade.highestPrice)}</b>`,
            `New Stop: <b>$${fmtPrice(trade.stopPrice)}</b>`,
            `Trail: <b>${Math.round(trailPercent * 100)}%</b>`,
            `ROI Now: <b>${roiNow.toFixed(1)}%</b>`,
            `Paper PnL: <b>${fmtSol(pnlSol)}</b>`,
            `Paper Value: <b>${valueSol.toFixed(4)} SOL</b>`,
          ].join('\n'),
          sellButtons(token)
        );
      }

      if (
          currentPrice <= trade.stopPrice &&
          !trade.sellInProgress
        ) {
        const isPaperPosition = trade.mode === 'paper';
        await sendTelegram(
          config.ownerChatId,
          [
            '🛑 <b>TRAILING STOP HIT</b>',
            '',
            `<b>${trade.symbol}</b>`,
            `Current Price: <b>$${fmtPrice(currentPrice)}</b>`,
            `Stop Price: <b>$${fmtPrice(trade.stopPrice)}</b>`,
            `Entry Price: <b>$${fmtPrice(trade.entryPrice)}</b>`,
            `Final ROI: <b>${roiNow.toFixed(1)}%</b>`,
            `Paper PnL: <b>${fmtSol(pnlSol)}</b>`,
            `Paper Exit Value: <b>${valueSol.toFixed(4)} SOL</b>`,
            '',
            isPaperPosition ? 'Paper selling 100%...' : 'Selling 100%...',
          ].join('\n')
        );

        await markSellRequested({
          positionId: trade.positionId,
          percent: 100,
        });

        await markSellPending(trade.positionId);

        const sell = isPaperPosition
        ? { signature: 'paper-sell-simulation' }
        : await adminSellTokenPercentWithRetry({
            inputMint: token,
            percent: 100,
          });

        await closePosition({
          positionId: trade.positionId,

          exitPrice: currentPrice,
          finalRoiPercent: roiNow,
          realisedPnlSol: pnlSol,

          sellSignature: sell.signature,

          beforeBalanceRaw: 'unknown',
          afterBalanceRaw: '0',
        });

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

        await sendTelegram(
          config.ownerChatId,
          [
            isPaperPosition
      ? '🧪 <b>PAPER AUTO SELL COMPLETE</b>'
      : '✅ <b>AUTO SELL EXECUTED</b>',
            '',
            `<b>${trade.symbol}</b>`,
            `Final ROI: <b>${roiNow.toFixed(1)}%</b>`,
            `Paper PnL: <b>${fmtSol(pnlSol)}</b>`,
            `Paper Exit Value: <b>${valueSol.toFixed(4)} SOL</b>`,
            `Tx: <code>${sell.signature}</code>`,
          ].join('\n')
        );
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
        [
          "⚠️ <b>AUTO TRADE CHECK FAILED</b>",
          "",
          `<b>${trade.symbol}</b>`,
          error instanceof Error
            ? error.message
            : String(error),
        ].join("\n"),
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
      status: "open",
      openedAt: new Date(position.openedAt ?? position.createdAt).getTime(),
      mode: position.mode,
      sellInProgress: false,
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