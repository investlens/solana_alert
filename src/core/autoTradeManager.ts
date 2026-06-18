import { config } from '../config.js';
import { adminBuyToken, adminSellTokenPercentWithRetry } from './adminTrading.js';
import { chooseBestPair, fetchPairs } from '../services/dexscreener.js';
import { saveClosedAutoTrade } from './autoTradeStore.js';
import { sendTelegram } from '../services/telegram.js';
import { recordTradeOpen, recordTradeClose } from './tradeAnalytics.js';

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
  token: string;
  symbol: string;
  entryPrice: number;
  highestPrice: number;
  stopPrice: number;
  amountSol: number;
  status: 'open' | 'closed';
  openedAt: number;
  mode: 'paper' | 'live';
};

type ClosedAutoTrade = AutoTrade & {
  closedAt: number;
  finalRoi: number;
  pnlSol: number;
  exitValueSol: number;
};

const activeTrades = new Map<string, AutoTrade>();
const closedTrades: ClosedAutoTrade[] = [];

const PAPER_MODE = false;
const CONFIRMATION_DELAY_MS = 25_000;
const MIN_CONFIRM_PRICE_RATIO = 0.97;
const MAX_CONFIRM_PRICE_RATIO = 1.12;
const MIN_CHECK_INTERVAL_MS = 20_000;

let lastRunAt = 0;

export function canStartNewTrade(token: string) {
  if (autoTradePaused) return false;
  if (activeTrades.has(token)) return false;
  if (activeTrades.size >= 3) return false;
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
  if (autoTradePaused) {
  await sendTelegram(
    config.ownerChatId,
    '⏸️ <b>AUTO TRADE PAUSED</b>\n\nSignal skipped because auto trading is paused.'
  );
  return;
}

  if (activeTrades.has(args.token)) return;

  const rejectedAt = recentlyRejected.get(args.token);

  if (rejectedAt && Date.now() - rejectedAt < REJECT_COOLDOWN_MS) {
    return;
  }

  if (!PAPER_MODE) {
    if (!config.adminTradingEnabled) return;
    if (!config.adminTradingPrivateKey) return;
  }

  await sendTelegram(
    config.ownerChatId,
    [
      '⏳ <b>AUTO BUY CONFIRMATION CHECK</b>',
      '',
      `<b>${args.symbol}</b>`,
      `Signal Price: <b>$${fmtPrice(args.entryPrice)}</b>`,
      'Waiting 25 seconds before entry...',
      '',
      'Will skip if price drops more than 3% or pumps more than 12%.',
    ].join('\n')
  );

  await sleep(CONFIRMATION_DELAY_MS);

  const confirmedPrice = await fetchCurrentPrice(args.token);

  if (!confirmedPrice) {
    await sendTelegram(
      config.ownerChatId,
      [
        '⚠️ <b>AUTO BUY SKIPPED</b>',
        '',
        `<b>${args.symbol}</b>`,
        'Could not fetch confirmation price.',
      ].join('\n')
    );

    recentlyRejected.set(args.token, Date.now());

    return;
  }

  if (confirmedPrice < args.entryPrice * MIN_CONFIRM_PRICE_RATIO) {
  const dropPct = ((confirmedPrice - args.entryPrice) / args.entryPrice) * 100;

  await sendTelegram(
    config.ownerChatId,
    [
      '🧊 <b>AUTO BUY SKIPPED</b>',
      '',
      `<b>${args.symbol}</b>`,
      `Signal Price: <b>$${fmtPrice(args.entryPrice)}</b>`,
      `Confirm Price: <b>$${fmtPrice(confirmedPrice)}</b>`,
      `Move: <b>${dropPct.toFixed(1)}%</b>`,
      '',
      'Reason: price dropped during confirmation window.',
    ].join('\n')
  );

  recentlyRejected.set(args.token, Date.now());
  return;
}

if (confirmedPrice > args.entryPrice * MAX_CONFIRM_PRICE_RATIO) {
  const pumpPct = ((confirmedPrice - args.entryPrice) / args.entryPrice) * 100;

  await sendTelegram(
    config.ownerChatId,
    [
      '🚫 <b>AUTO BUY SKIPPED</b>',
      '',
      `<b>${args.symbol}</b>`,
      `Signal Price: <b>$${fmtPrice(args.entryPrice)}</b>`,
      `Confirm Price: <b>$${fmtPrice(confirmedPrice)}</b>`,
      `Move: <b>+${pumpPct.toFixed(1)}%</b>`,
      '',
      'Reason: price moved too fast before entry. Avoiding top-buy.',
    ].join('\n')
  );

  recentlyRejected.set(args.token, Date.now());
  return;
}

  const amountSol = args.amountSol ?? config.adminBuyAmountDefaultSol;

  let trade: { signature: string };

try {
  trade = PAPER_MODE
    ? { signature: 'paper-trade-simulation' }
    : await adminBuyToken({
        outputMint: args.token,
        amountSol,
      });
} catch (err) {
  console.error('AUTO BUY FAILED FULL:', err);

  await sendTelegram(
    config.ownerChatId,
    [
      '❌ <b>AUTO BUY FAILED</b>',
      '',
      `<b>${args.symbol}</b>`,
      `Token: <code>${args.token}</code>`,
      '',
      err instanceof Error ? err.message : String(err),
    ].join('\n')
  );

  return;
}

  const position: AutoTrade = {
    token: args.token,
    symbol: args.symbol,
    entryPrice: confirmedPrice,
    highestPrice: confirmedPrice,
    stopPrice: confirmedPrice * 0.92,
    amountSol,
    status: 'open',
    openedAt: Date.now(),
    mode: PAPER_MODE ? 'paper' : 'live',
  };

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
      PAPER_MODE ? '🧪 <b>PAPER AUTO BUY STARTED</b>' : '🤖 <b>AUTO BUY EXECUTED</b>',
      '',
      `<b>${args.symbol}</b>`,
      `Amount: <b>${amountSol.toFixed(4)} SOL</b>`,
      `Entry Price: <b>$${fmtPrice(confirmedPrice)}</b>`,
      `Initial Stop: <b>$${fmtPrice(position.stopPrice)}</b>`,
      `Initial Stop Width: <b>8%</b>`,
      '',
      'Admin override available below.',
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

  const sell = PAPER_MODE
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
      PAPER_MODE ? '🧪 <b>PAPER MANUAL SELL</b>' : '✅ <b>MANUAL SELL EXECUTED</b>',
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
    message: `${PAPER_MODE ? 'Paper' : 'Live'} manual sell ${percent}% complete.`,
  };
}

export async function runAutoTradeManager() {
  if (Date.now() - lastRunAt < MIN_CHECK_INTERVAL_MS) return;
  lastRunAt = Date.now();

  for (const [token, trade] of activeTrades.entries()) {
    if (trade.status !== 'open') continue;

    try {
      const currentPrice = await fetchCurrentPrice(token);
      if (!currentPrice) continue;

      const roiNow = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
      const pnlSol = calcPnlSol(trade.amountSol, roiNow);
      const valueSol = trade.amountSol + pnlSol;

      if (currentPrice > trade.highestPrice) {
        trade.highestPrice = currentPrice;

        const highRoi = ((trade.highestPrice - trade.entryPrice) / trade.entryPrice) * 100;
        const trailPercent = trailPercentForRoi(highRoi);
        trade.stopPrice = trade.highestPrice * (1 - trailPercent);

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

      if (currentPrice <= trade.stopPrice) {
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
            PAPER_MODE ? 'Paper selling 100%...' : 'Selling 100%...',
          ].join('\n')
        );

        const sell = PAPER_MODE
        ? { signature: 'paper-sell-simulation' }
        : await adminSellTokenPercentWithRetry({
            inputMint: token,
            percent: 100,
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
            PAPER_MODE ? '🧪 <b>PAPER AUTO SELL COMPLETE</b>' : '✅ <b>AUTO SELL EXECUTED</b>',
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
      await sendTelegram(
        config.ownerChatId,
        [
          '⚠️ <b>AUTO TRADE CHECK FAILED</b>',
          '',
          `<b>${trade.symbol}</b>`,
          error instanceof Error ? error.message : String(error),
        ].join('\n')
      );
    }
  }
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