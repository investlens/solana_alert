import { supabase } from '../services/supabase.js';

export type PositionMode = 'paper' | 'live';

export type PositionStatus =
  | 'PENDING_BUY'
  | 'BUY_RECONCILIATION_REQUIRED'
  | 'BUY_FAILED'
  | 'OPEN'
  | 'PARTIAL_EXIT'
  | 'SELL_REQUESTED'
  | 'SELL_PENDING'
  | 'SELL_RECONCILIATION_REQUIRED'
  | 'SELL_FAILED'
  | 'CLOSED';

export type TradePosition = {
  id: string;

  token: string;
  symbol: string;
  walletAddress: string | null;
  mode: PositionMode;
  status: PositionStatus;

  signalPrice: number | null;
  entryPrice: number | null;
  entrySolAmount: number;
  initialTokenAmount: number | null;
  remainingTokenAmount: number | null;
  remainingPercent: number;

  currentPrice: number | null;
  highestPrice: number | null;
  stopPrice: number | null;
  trailingStopPercent: number | null;

  currentRoiPercent: number;
  peakRoiPercent: number;
  protectedRoiPercent: number | null;
  unrealizedPnlSol: number;
  realizedPnlSol: number;
  estimatedValueSol: number;

  takeProfitTriggered: boolean;
  takeProfitTriggerPercent: number;
  takeProfitSellPercent: number;

  moonbagMode: boolean;
  moonbagTrailingStopPercent: number;

  autoManageEnabled: boolean;
  trailingStopEnabled: boolean;
  manualOverride: boolean;

  buySignature: string | null;
  buyBeforeBalanceRaw: string | null;
  buyAfterBalanceRaw: string | null;
  buyError: string | null;

  lastSellSignature: string | null;
  lastSellPercent: number | null;
  sellBeforeBalanceRaw: string | null;
  sellAfterBalanceRaw: string | null;
  sellRetryCount: number;
  lastSellError: string | null;
  lastSellAttemptAt: string | null;

  entryScore: number | null;
  creatorScore: number | null;
  holderRisk: number | null;
  bundleRisk: number | null;
  liquidity: number | null;
  volume5m: number | null;

  aiRecommendation: string | null;
  aiCommentary: string | null;

  signalReceivedAt: string | null;
  buyRequestedAt: string | null;
  openedAt: string | null;
  partialExitAt: string | null;
  sellRequestedAt: string | null;
  closedAt: string | null;
  lastPriceCheckAt: string | null;

  createdAt: string;
  updatedAt: string;
};

export type PositionEventType =
  | 'SIGNAL_RECEIVED'
  | 'BUY_REQUESTED'
  | 'BUY_CONFIRMED'
  | 'BUY_FAILED'
  | 'BUY_RECONCILIATION_REQUIRED'
  | 'POSITION_RESTORED'
  | 'PRICE_UPDATED'
  | 'NEW_HIGH'
  | 'STOP_MOVED'
  | 'TAKE_PROFIT_TRIGGERED'
  | 'MOONBAG_ACTIVATED'
  | 'SELL_REQUESTED'
  | 'SELL_CONFIRMED'
  | 'SELL_FAILED'
  | 'SELL_RECONCILIATION_REQUIRED'
  | 'POSITION_CLOSED'
  | 'MANUAL_OVERRIDE'
  | 'AUTO_MANAGE_PAUSED'
  | 'AUTO_MANAGE_RESUMED';

const ACTIVE_POSITION_STATUSES: PositionStatus[] = [
  'PENDING_BUY',
  'BUY_RECONCILIATION_REQUIRED',
  'OPEN',
  'PARTIAL_EXIT',
  'SELL_REQUESTED',
  'SELL_PENDING',
  'SELL_RECONCILIATION_REQUIRED',
  'SELL_FAILED',
];

function toNumber(
  value: unknown,
  fallback: number | null = null,
): number | null {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function requiredNumber(value: unknown, fallback = 0): number {
  return toNumber(value, fallback) ?? fallback;
}

function mapPosition(row: any): TradePosition {
  return {
    id: String(row.id),

    token: String(row.token),
    symbol: String(row.symbol ?? 'UNKNOWN'),
    walletAddress: row.wallet_address ?? null,
    mode: row.mode as PositionMode,
    status: row.status as PositionStatus,

    signalPrice: toNumber(row.signal_price),
    entryPrice: toNumber(row.entry_price),
    entrySolAmount: requiredNumber(row.entry_sol_amount),
    initialTokenAmount: toNumber(row.initial_token_amount),
    remainingTokenAmount: toNumber(row.remaining_token_amount),
    remainingPercent: requiredNumber(row.remaining_percent, 100),

    currentPrice: toNumber(row.current_price),
    highestPrice: toNumber(row.highest_price),
    stopPrice: toNumber(row.stop_price),
    trailingStopPercent: toNumber(row.trailing_stop_percent),

    currentRoiPercent: requiredNumber(row.current_roi_percent),
    peakRoiPercent: requiredNumber(row.peak_roi_percent),
    protectedRoiPercent: toNumber(row.protected_roi_percent),
    unrealizedPnlSol: requiredNumber(row.unrealized_pnl_sol),
    realizedPnlSol: requiredNumber(row.realized_pnl_sol),
    estimatedValueSol: requiredNumber(row.estimated_value_sol),

    takeProfitTriggered: Boolean(row.take_profit_triggered),
    takeProfitTriggerPercent: requiredNumber(
      row.take_profit_trigger_percent,
      100,
    ),
    takeProfitSellPercent: requiredNumber(
      row.take_profit_sell_percent,
      50,
    ),

    moonbagMode: Boolean(row.moonbag_mode),
    moonbagTrailingStopPercent: requiredNumber(
      row.moonbag_trailing_stop_percent,
      5,
    ),

    autoManageEnabled: Boolean(row.auto_manage_enabled),
    trailingStopEnabled: Boolean(row.trailing_stop_enabled),
    manualOverride: Boolean(row.manual_override),

    buySignature: row.buy_signature ?? null,
    buyBeforeBalanceRaw: row.buy_before_balance_raw ?? null,
    buyAfterBalanceRaw: row.buy_after_balance_raw ?? null,
    buyError: row.buy_error ?? null,

    lastSellSignature: row.last_sell_signature ?? null,
    lastSellPercent: toNumber(row.last_sell_percent),
    sellBeforeBalanceRaw: row.sell_before_balance_raw ?? null,
    sellAfterBalanceRaw: row.sell_after_balance_raw ?? null,
    sellRetryCount: requiredNumber(row.sell_retry_count),
    lastSellError: row.last_sell_error ?? null,
    lastSellAttemptAt: row.last_sell_attempt_at ?? null,

    entryScore: toNumber(row.entry_score),
    creatorScore: toNumber(row.creator_score),
    holderRisk: toNumber(row.holder_risk),
    bundleRisk: toNumber(row.bundle_risk),
    liquidity: toNumber(row.liquidity),
    volume5m: toNumber(row.volume_5m),

    aiRecommendation: row.ai_recommendation ?? null,
    aiCommentary: row.ai_commentary ?? null,

    signalReceivedAt: row.signal_received_at ?? null,
    buyRequestedAt: row.buy_requested_at ?? null,
    openedAt: row.opened_at ?? null,
    partialExitAt: row.partial_exit_at ?? null,
    sellRequestedAt: row.sell_requested_at ?? null,
    closedAt: row.closed_at ?? null,
    lastPriceCheckAt: row.last_price_check_at ?? null,

    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function requirePosition(
  positionId: string,
): Promise<TradePosition> {
  const position = await getPositionById(positionId);

  if (!position) {
    throw new Error(`Position not found: ${positionId}`);
  }

  return position;
}

export async function addPositionEvent(args: {
  positionId: string;
  eventType: PositionEventType;
  title: string;
  message?: string | null;
  price?: number | null;
  roiPercent?: number | null;
  tokenBalanceRaw?: string | null;
  transactionSignature?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase
    .from('trade_position_events')
    .insert({
      position_id: args.positionId,
      event_type: args.eventType,
      title: args.title,
      message: args.message ?? null,
      price: args.price ?? null,
      roi_percent: args.roiPercent ?? null,
      token_balance_raw: args.tokenBalanceRaw ?? null,
      transaction_signature:
        args.transactionSignature ?? null,
      metadata: args.metadata ?? {},
    });

  if (error) {
    console.error('[PositionManager] Event insert failed:', {
      positionId: args.positionId,
      eventType: args.eventType,
      error: error.message,
    });
  }
}

export async function createPendingPosition(args: {
  token: string;
  symbol: string;
  walletAddress?: string | null;
  mode: PositionMode;

  signalPrice?: number | null;
  entrySolAmount: number;

  takeProfitTriggerPercent?: number;
  takeProfitSellPercent?: number;
  moonbagTrailingStopPercent?: number;

  entryScore?: number | null;
  creatorScore?: number | null;
  holderRisk?: number | null;
  bundleRisk?: number | null;
  liquidity?: number | null;
  volume5m?: number | null;

  aiRecommendation?: string | null;
  aiCommentary?: string | null;
}): Promise<TradePosition> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('trade_positions')
    .insert({
      token: args.token,
      symbol: args.symbol,
      wallet_address: args.walletAddress ?? null,
      mode: args.mode,
      status: 'PENDING_BUY',

      signal_price: args.signalPrice ?? null,
      entry_sol_amount: args.entrySolAmount,

      remaining_percent: 100,

      take_profit_trigger_percent:
        args.takeProfitTriggerPercent ?? 100,
      take_profit_sell_percent:
        args.takeProfitSellPercent ?? 50,
      moonbag_trailing_stop_percent:
        args.moonbagTrailingStopPercent ?? 5,

      entry_score: args.entryScore ?? null,
      creator_score: args.creatorScore ?? null,
      holder_risk: args.holderRisk ?? null,
      bundle_risk: args.bundleRisk ?? null,
      liquidity: args.liquidity ?? null,
      volume_5m: args.volume5m ?? null,

      ai_recommendation: args.aiRecommendation ?? null,
      ai_commentary: args.aiCommentary ?? null,

      signal_received_at: now,
      buy_requested_at: now,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error(
        `An active position already exists for ${args.symbol} (${args.token})`,
      );
    }

    throw new Error(
      `Could not create pending position: ${error.message}`,
    );
  }

  const position = mapPosition(data);

  await addPositionEvent({
    positionId: position.id,
    eventType: 'BUY_REQUESTED',
    title: 'Buy requested',
    message: `${args.entrySolAmount} SOL buy requested for ${args.symbol}.`,
    price: args.signalPrice ?? null,
    metadata: {
      mode: args.mode,
      entrySolAmount: args.entrySolAmount,
    },
  });

  return position;
}

export async function markPositionOpen(args: {
  positionId: string;
  entryPrice: number;
  initialTokenAmount: number;
  stopPrice: number;
  trailingStopPercent?: number | null;

  buySignature: string;
  buyBeforeBalanceRaw: string;
  buyAfterBalanceRaw: string;
}): Promise<TradePosition> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('trade_positions')
    .update({
      status: 'OPEN',

      entry_price: args.entryPrice,
      current_price: args.entryPrice,
      highest_price: args.entryPrice,
      stop_price: args.stopPrice,
      trailing_stop_percent:
        args.trailingStopPercent ?? null,

      initial_token_amount: args.initialTokenAmount,
      remaining_token_amount: args.initialTokenAmount,
      remaining_percent: 100,

      current_roi_percent: 0,
      peak_roi_percent: 0,
      protected_roi_percent: null,
      unrealized_pnl_sol: 0,

      buy_signature: args.buySignature,
      buy_before_balance_raw:
        args.buyBeforeBalanceRaw,
      buy_after_balance_raw:
        args.buyAfterBalanceRaw,
      buy_error: null,

      opened_at: now,
      last_price_check_at: now,
    })
    .eq('id', args.positionId)
    .select('*')
    .single();

  if (error) {
    throw new Error(
      `Could not mark position OPEN: ${error.message}`,
    );
  }

  const position = mapPosition(data);

  await addPositionEvent({
    positionId: position.id,
    eventType: 'BUY_CONFIRMED',
    title: 'Buy confirmed',
    message: `${position.symbol} position opened and wallet balance verified.`,
    price: args.entryPrice,
    roiPercent: 0,
    tokenBalanceRaw: args.buyAfterBalanceRaw,
    transactionSignature: args.buySignature,
  });

  return position;
}

export async function markBuyFailed(args: {
  positionId: string;
  errorMessage: string;
}): Promise<TradePosition> {
  const { data, error } = await supabase
    .from('trade_positions')
    .update({
      status: 'BUY_FAILED',
      buy_error: args.errorMessage,
      auto_manage_enabled: false,
    })
    .eq('id', args.positionId)
    .select('*')
    .single();

  if (error) {
    throw new Error(
      `Could not mark buy failed: ${error.message}`,
    );
  }

  const position = mapPosition(data);

  await addPositionEvent({
    positionId: position.id,
    eventType: 'BUY_FAILED',
    title: 'Buy failed',
    message: args.errorMessage,
  });

  return position;
}

export async function markBuyReconciliationRequired(args: {
  positionId: string;
  buySignature?: string | null;
  buyBeforeBalanceRaw?: string | null;
  errorMessage: string;
}): Promise<TradePosition> {
  const { data, error } = await supabase
    .from('trade_positions')
    .update({
      status: 'BUY_RECONCILIATION_REQUIRED',
      buy_signature: args.buySignature ?? null,
      buy_before_balance_raw:
        args.buyBeforeBalanceRaw ?? null,
      buy_error: args.errorMessage,
      auto_manage_enabled: false,
    })
    .eq('id', args.positionId)
    .select('*')
    .single();

  if (error) {
    throw new Error(
      `Could not mark buy for reconciliation: ${error.message}`,
    );
  }

  const position = mapPosition(data);

  await addPositionEvent({
    positionId: position.id,
    eventType: 'BUY_RECONCILIATION_REQUIRED',
    title: 'Buy reconciliation required',
    message: args.errorMessage,
    transactionSignature: args.buySignature ?? null,
  });

  return position;
}

export async function updatePositionMarket(args: {
  positionId: string;
  currentPrice: number;
  highestPrice: number;
  stopPrice: number;
  trailingStopPercent?: number | null;

  currentRoiPercent: number;
  peakRoiPercent: number;
  protectedRoiPercent?: number | null;

  unrealizedPnlSol: number;
  estimatedValueSol: number;

  aiRecommendation?: string | null;
  aiCommentary?: string | null;
}): Promise<TradePosition> {
  const { data, error } = await supabase
    .from('trade_positions')
    .update({
      current_price: args.currentPrice,
      highest_price: args.highestPrice,
      stop_price: args.stopPrice,
      trailing_stop_percent:
        args.trailingStopPercent ?? null,

      current_roi_percent: args.currentRoiPercent,
      peak_roi_percent: args.peakRoiPercent,
      protected_roi_percent:
        args.protectedRoiPercent ?? null,

      unrealized_pnl_sol: args.unrealizedPnlSol,
      estimated_value_sol: args.estimatedValueSol,

      ai_recommendation:
        args.aiRecommendation ?? undefined,
      ai_commentary:
        args.aiCommentary ?? undefined,

      last_price_check_at: new Date().toISOString(),
    })
    .eq('id', args.positionId)
    .select('*')
    .single();

  if (error) {
    throw new Error(
      `Could not update position market data: ${error.message}`,
    );
  }

  return mapPosition(data);
}

export async function markSellRequested(args: {
  positionId: string;
  percent: number;
}): Promise<TradePosition> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('trade_positions')
    .update({
      status: 'SELL_REQUESTED',
      last_sell_percent: args.percent,
      sell_requested_at: now,
      last_sell_attempt_at: now,
      last_sell_error: null,
    })
    .eq('id', args.positionId)
    .select('*')
    .single();

  if (error) {
    throw new Error(
      `Could not mark sell requested: ${error.message}`,
    );
  }

  const position = mapPosition(data);

  await addPositionEvent({
    positionId: position.id,
    eventType: 'SELL_REQUESTED',
    title: `Sell ${args.percent}% requested`,
    message: `${args.percent}% exit requested for ${position.symbol}.`,
    price: position.currentPrice,
    roiPercent: position.currentRoiPercent,
  });

  return position;
}

export async function markSellPending(
  positionId: string,
): Promise<TradePosition> {
  const { data, error } = await supabase
    .from('trade_positions')
    .update({
      status: 'SELL_PENDING',
      last_sell_attempt_at: new Date().toISOString(),
    })
    .eq('id', positionId)
    .select('*')
    .single();

  if (error) {
    throw new Error(
      `Could not mark sell pending: ${error.message}`,
    );
  }

  return mapPosition(data);
}

export async function markSellFailed(args: {
  positionId: string;
  errorMessage: string;
  retryCount?: number;
}): Promise<TradePosition> {
  const current = await requirePosition(args.positionId);

  const retryCount =
    args.retryCount ?? current.sellRetryCount + 1;

  const { data, error } = await supabase
    .from('trade_positions')
    .update({
      status: 'SELL_FAILED',
      sell_retry_count: retryCount,
      last_sell_error: args.errorMessage,
      last_sell_attempt_at: new Date().toISOString(),
    })
    .eq('id', args.positionId)
    .select('*')
    .single();

  if (error) {
    throw new Error(
      `Could not mark sell failed: ${error.message}`,
    );
  }

  const position = mapPosition(data);

  await addPositionEvent({
    positionId: position.id,
    eventType: 'SELL_FAILED',
    title: 'Sell failed',
    message: args.errorMessage,
    price: position.currentPrice,
    roiPercent: position.currentRoiPercent,
    metadata: {
      retryCount,
    },
  });

  return position;
}

export async function markSellReconciliationRequired(args: {
  positionId: string;
  percent: number;
  sellSignature: string;
  beforeBalanceRaw: string;
  errorMessage: string;
}): Promise<TradePosition> {
  const { data, error } = await supabase
    .from('trade_positions')
    .update({
      status: 'SELL_RECONCILIATION_REQUIRED',

      last_sell_percent: args.percent,
      last_sell_signature: args.sellSignature,
      sell_before_balance_raw:
        args.beforeBalanceRaw,
      sell_after_balance_raw: null,

      last_sell_error: args.errorMessage,
      last_sell_attempt_at: new Date().toISOString(),
      auto_manage_enabled: false,
    })
    .eq('id', args.positionId)
    .select('*')
    .single();

  if (error) {
    throw new Error(
      `Could not mark sell reconciliation: ${error.message}`,
    );
  }

  const position = mapPosition(data);

  await addPositionEvent({
    positionId: position.id,
    eventType: 'SELL_RECONCILIATION_REQUIRED',
    title: 'Sell reconciliation required',
    message: args.errorMessage,
    price: position.currentPrice,
    roiPercent: position.currentRoiPercent,
    tokenBalanceRaw: args.beforeBalanceRaw,
    transactionSignature: args.sellSignature,
    metadata: {
      percent: args.percent,
    },
  });

  return position;
}

export async function applyPartialExit(args: {
  positionId: string;

  soldPercentOfCurrentBalance: number;
  remainingTokenAmount: number;
  remainingPercent: number;

  realisedPnlSol: number;

  sellSignature: string;
  beforeBalanceRaw: string;
  afterBalanceRaw: string;

  activateMoonbag?: boolean;
}): Promise<TradePosition> {
  const current = await requirePosition(args.positionId);
  const now = new Date().toISOString();

  const totalRealisedPnl =
    current.realizedPnlSol + args.realisedPnlSol;

  const { data, error } = await supabase
    .from('trade_positions')
    .update({
      status: 'PARTIAL_EXIT',

      remaining_token_amount:
        args.remainingTokenAmount,
      remaining_percent: args.remainingPercent,

      realized_pnl_sol: totalRealisedPnl,

      take_profit_triggered:
        current.takeProfitTriggered ||
        args.activateMoonbag === true,

      moonbag_mode:
        current.moonbagMode ||
        args.activateMoonbag === true,

      last_sell_percent:
        args.soldPercentOfCurrentBalance,
      last_sell_signature: args.sellSignature,
      sell_before_balance_raw:
        args.beforeBalanceRaw,
      sell_after_balance_raw:
        args.afterBalanceRaw,

      sell_retry_count: 0,
      last_sell_error: null,
      partial_exit_at: now,
      last_sell_attempt_at: now,
      auto_manage_enabled: true,
    })
    .eq('id', args.positionId)
    .select('*')
    .single();

  if (error) {
    throw new Error(
      `Could not apply partial exit: ${error.message}`,
    );
  }

  const position = mapPosition(data);

  await addPositionEvent({
    positionId: position.id,
    eventType: 'SELL_CONFIRMED',
    title: `${args.soldPercentOfCurrentBalance}% partial exit confirmed`,
    message: `${position.symbol} partial sell confirmed and wallet balance verified.`,
    price: position.currentPrice,
    roiPercent: position.currentRoiPercent,
    tokenBalanceRaw: args.afterBalanceRaw,
    transactionSignature: args.sellSignature,
    metadata: {
      remainingPercent: args.remainingPercent,
      realisedPnlSol: args.realisedPnlSol,
      moonbagActivated:
        args.activateMoonbag === true,
    },
  });

  if (args.activateMoonbag) {
    await addPositionEvent({
      positionId: position.id,
      eventType: 'MOONBAG_ACTIVATED',
      title: 'Moonbag Mode activated',
      message: `Remaining ${args.remainingPercent}% is protected by the Moonbag trailing strategy.`,
      price: position.currentPrice,
      roiPercent: position.currentRoiPercent,
    });
  }

  return position;
}

export async function closePosition(args: {
  positionId: string;

  exitPrice: number;
  finalRoiPercent: number;
  realisedPnlSol: number;

  sellSignature: string;
  beforeBalanceRaw: string;
  afterBalanceRaw: string;
}): Promise<TradePosition> {
  const current = await requirePosition(args.positionId);
  const now = new Date().toISOString();

  const totalRealisedPnl =
    current.realizedPnlSol + args.realisedPnlSol;

  const { data, error } = await supabase
    .from('trade_positions')
    .update({
      status: 'CLOSED',

      current_price: args.exitPrice,
      current_roi_percent: args.finalRoiPercent,

      remaining_token_amount: 0,
      remaining_percent: 0,

      unrealized_pnl_sol: 0,
      realized_pnl_sol: totalRealisedPnl,

      last_sell_percent: 100,
      last_sell_signature: args.sellSignature,
      sell_before_balance_raw:
        args.beforeBalanceRaw,
      sell_after_balance_raw:
        args.afterBalanceRaw,

      sell_retry_count: 0,
      last_sell_error: null,

      auto_manage_enabled: false,
      closed_at: now,
      last_sell_attempt_at: now,
      last_price_check_at: now,
    })
    .eq('id', args.positionId)
    .select('*')
    .single();

  if (error) {
    /*
     * The database column uses American spelling:
     * realised_pnl_sol above would fail.
     * Retry immediately with the real column name.
     */
    const { data: retryData, error: retryError } =
      await supabase
        .from('trade_positions')
        .update({
          status: 'CLOSED',

          current_price: args.exitPrice,
          current_roi_percent:
            args.finalRoiPercent,

          remaining_token_amount: 0,
          remaining_percent: 0,

          unrealized_pnl_sol: 0,
          realized_pnl_sol: totalRealisedPnl,

          last_sell_percent: 100,
          last_sell_signature:
            args.sellSignature,
          sell_before_balance_raw:
            args.beforeBalanceRaw,
          sell_after_balance_raw:
            args.afterBalanceRaw,

          sell_retry_count: 0,
          last_sell_error: null,

          auto_manage_enabled: false,
          closed_at: now,
          last_sell_attempt_at: now,
          last_price_check_at: now,
        })
        .eq('id', args.positionId)
        .select('*')
        .single();

    if (retryError) {
      throw new Error(
        `Could not close position: ${retryError.message}`,
      );
    }

    const retryPosition = mapPosition(retryData);

    await addPositionEvent({
      positionId: retryPosition.id,
      eventType: 'POSITION_CLOSED',
      title: 'Position closed',
      message: `${retryPosition.symbol} position closed and final wallet balance verified.`,
      price: args.exitPrice,
      roiPercent: args.finalRoiPercent,
      tokenBalanceRaw: args.afterBalanceRaw,
      transactionSignature: args.sellSignature,
      metadata: {
        realisedPnlSol: totalRealisedPnl,
      },
    });

    return retryPosition;
  }

  const position = mapPosition(data);

  await addPositionEvent({
    positionId: position.id,
    eventType: 'POSITION_CLOSED',
    title: 'Position closed',
    message: `${position.symbol} position closed and final wallet balance verified.`,
    price: args.exitPrice,
    roiPercent: args.finalRoiPercent,
    tokenBalanceRaw: args.afterBalanceRaw,
    transactionSignature: args.sellSignature,
    metadata: {
      realisedPnlSol: totalRealisedPnl,
    },
  });

  return position;
}

export async function setAutoManageEnabled(args: {
  positionId: string;
  enabled: boolean;
}): Promise<TradePosition> {
  const { data, error } = await supabase
    .from('trade_positions')
    .update({
      auto_manage_enabled: args.enabled,
      manual_override: !args.enabled,
    })
    .eq('id', args.positionId)
    .select('*')
    .single();

  if (error) {
    throw new Error(
      `Could not change auto-manage setting: ${error.message}`,
    );
  }

  const position = mapPosition(data);

  await addPositionEvent({
    positionId: position.id,
    eventType: args.enabled
      ? 'AUTO_MANAGE_RESUMED'
      : 'AUTO_MANAGE_PAUSED',
    title: args.enabled
      ? 'AI management resumed'
      : 'AI management paused',
    message: args.enabled
      ? 'AlphaOS resumed automatic position protection.'
      : 'Automatic position actions were paused by the admin.',
  });

  return position;
}

export async function getPositionById(
  positionId: string,
): Promise<TradePosition | null> {
  const { data, error } = await supabase
    .from('trade_positions')
    .select('*')
    .eq('id', positionId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Could not fetch position: ${error.message}`,
    );
  }

  return data ? mapPosition(data) : null;
}

export async function getActivePositionByToken(args: {
  token: string;
  walletAddress?: string | null;
  mode?: PositionMode;
}): Promise<TradePosition | null> {
  let query = supabase
    .from('trade_positions')
    .select('*')
    .eq('token', args.token)
    .in('status', ACTIVE_POSITION_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1);

  if (args.walletAddress) {
    query = query.eq(
      'wallet_address',
      args.walletAddress,
    );
  }

  if (args.mode) {
    query = query.eq('mode', args.mode);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(
      `Could not fetch active position: ${error.message}`,
    );
  }

  return data ? mapPosition(data) : null;
}

export async function getActivePositions(): Promise<
  TradePosition[]
> {
  const { data, error } = await supabase
    .from('trade_positions')
    .select('*')
    .in('status', ACTIVE_POSITION_STATUSES)
    .order('opened_at', {
      ascending: true,
      nullsFirst: true,
    });

  if (error) {
    throw new Error(
      `Could not fetch active positions: ${error.message}`,
    );
  }

  return (data ?? []).map(mapPosition);
}

export async function getPositionEvents(
  positionId: string,
  limit = 50,
) {
  const { data, error } = await supabase
    .from('trade_position_events')
    .select('*')
    .eq('position_id', positionId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(
      `Could not fetch position events: ${error.message}`,
    );
  }

  return data ?? [];
}

export async function restoreActivePositions(): Promise<
  TradePosition[]
> {
  const positions = await getActivePositions();

  console.log(
    `[PositionManager] Restored ${positions.length} active position(s).`,
  );

  for (const position of positions) {
    console.log('[PositionManager] Restored:', {
      id: position.id,
      token: position.token,
      symbol: position.symbol,
      status: position.status,
      entryPrice: position.entryPrice,
      highestPrice: position.highestPrice,
      stopPrice: position.stopPrice,
      remainingPercent: position.remainingPercent,
      mode: position.mode,
    });

    await addPositionEvent({
      positionId: position.id,
      eventType: 'POSITION_RESTORED',
      title: 'Position restored',
      message:
        'Position was restored after AlphaOS startup.',
      price: position.currentPrice,
      roiPercent: position.currentRoiPercent,
      metadata: {
        restoredStatus: position.status,
      },
    });
  }

  return positions;
}