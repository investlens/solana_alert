import { supabase } from "./supabase.js";

export type AlphaSettings = {
  // Alert strategy
  minScore: number;
  maxAgeMin: number;
  minLiquidity: number;
  maxLiquidity: number;
  minVolume5m: number;
  minBuyRatio: number;

  alertMode: "strict" | "balanced" | "aggressive";
  strategyProfile: "strict" | "balanced" | "aggressive";

  // Platform controls
  alertsPaused: boolean;
  terminalEnabled: boolean;
  telegramPremiumEnabled: boolean;
  scannerEnabled: boolean;
  aiDecisionEnabled: boolean;
  restartRequested: boolean;

  // Admin trading controls
  adminAutoBuyEnabled: boolean;
  adminTradeAmountSol: number;
  entryConfirmationSeconds: number;
  maxEntryDipPercent: number;
  maxEntryPumpPercent: number;
  maxOpenPositions: number;

  // Position protection
  initialStopLossPercent: number;
  trailingStopEnabled: boolean;

  // Dump-risk protection
  dumpRiskExitEnabled: boolean;
  dumpRiskWarningScore: number;
  dumpRiskExitScore: number;

  creatorSellExitEnabled: boolean;
  bundleSellExitEnabled: boolean;
  liquidityDropExitEnabled: boolean;
};

const DEFAULT_SETTINGS: AlphaSettings = {
  // Alert strategy
  minScore: 72,
  maxAgeMin: 75,
  minLiquidity: 6000,
  maxLiquidity: 65000,
  minVolume5m: 3000,
  minBuyRatio: 1.4,

  alertMode: "balanced",
  strategyProfile: "balanced",

  // Platform controls
  alertsPaused: false,
  terminalEnabled: true,
  telegramPremiumEnabled: true,
  scannerEnabled: true,
  aiDecisionEnabled: true,
  restartRequested: false,

  // Admin trading controls
  adminAutoBuyEnabled: false,
  adminTradeAmountSol: 0.01,
  entryConfirmationSeconds: 30,
  maxEntryDipPercent: 3,
  maxEntryPumpPercent: 12,
  maxOpenPositions: 1,

  // Position protection
  initialStopLossPercent: 8,
  trailingStopEnabled: true,

  // Dump-risk protection
  dumpRiskExitEnabled: true,
  dumpRiskWarningScore: 40,
  dumpRiskExitScore: 65,

  creatorSellExitEnabled: true,
  bundleSellExitEnabled: true,
  liquidityDropExitEnabled: true,
};

let cachedSettings: AlphaSettings = DEFAULT_SETTINGS;
let lastLoadedAt = 0;

const CACHE_MS = 15_000;

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }

  return fallback;
}

function asMode(
  value: unknown,
  fallback: "strict" | "balanced" | "aggressive",
): "strict" | "balanced" | "aggressive" {
  if (
    value === "strict" ||
    value === "balanced" ||
    value === "aggressive"
  ) {
    return value;
  }

  return fallback;
}

export async function getAlphaSettings(
  forceRefresh = false,
): Promise<AlphaSettings> {
  const now = Date.now();

  if (!forceRefresh && now - lastLoadedAt < CACHE_MS) {
    return cachedSettings;
  }

  const { data, error } = await supabase
    .from("strategy_settings")
    .select("key,value");

  if (error) {
    console.error(
      "⚠️ Failed to load strategy settings:",
      error.message,
    );

    return cachedSettings;
  }

  const map = new Map<string, unknown>();

  for (const row of data ?? []) {
    map.set(row.key, row.value);
  }

  cachedSettings = {
    // Alert strategy
    minScore: asNumber(
      map.get("min_score"),
      DEFAULT_SETTINGS.minScore,
    ),

    maxAgeMin: asNumber(
      map.get("max_age_min"),
      DEFAULT_SETTINGS.maxAgeMin,
    ),

    minLiquidity: asNumber(
      map.get("min_liquidity"),
      DEFAULT_SETTINGS.minLiquidity,
    ),

    maxLiquidity: asNumber(
      map.get("max_liquidity"),
      DEFAULT_SETTINGS.maxLiquidity,
    ),

    minVolume5m: asNumber(
      map.get("min_volume_5m"),
      DEFAULT_SETTINGS.minVolume5m,
    ),

    minBuyRatio: asNumber(
      map.get("min_buy_ratio"),
      DEFAULT_SETTINGS.minBuyRatio,
    ),

    alertMode: asMode(
      map.get("alert_mode"),
      DEFAULT_SETTINGS.alertMode,
    ),

    strategyProfile: asMode(
      map.get("strategy_profile"),
      DEFAULT_SETTINGS.strategyProfile,
    ),

    // Platform controls
    alertsPaused: asBoolean(
      map.get("alerts_paused"),
      DEFAULT_SETTINGS.alertsPaused,
    ),

    terminalEnabled: asBoolean(
      map.get("terminal_enabled"),
      DEFAULT_SETTINGS.terminalEnabled,
    ),

    telegramPremiumEnabled: asBoolean(
      map.get("telegram_premium_enabled"),
      DEFAULT_SETTINGS.telegramPremiumEnabled,
    ),

    scannerEnabled: asBoolean(
      map.get("scanner_enabled"),
      DEFAULT_SETTINGS.scannerEnabled,
    ),

    aiDecisionEnabled: asBoolean(
      map.get("ai_decision_enabled"),
      DEFAULT_SETTINGS.aiDecisionEnabled,
    ),

    restartRequested: asBoolean(
      map.get("restart_requested"),
      DEFAULT_SETTINGS.restartRequested,
    ),

    // Admin trading
    adminAutoBuyEnabled: asBoolean(
      map.get("admin_auto_buy_enabled"),
      DEFAULT_SETTINGS.adminAutoBuyEnabled,
    ),

    adminTradeAmountSol: asNumber(
      map.get("admin_trade_amount_sol"),
      DEFAULT_SETTINGS.adminTradeAmountSol,
    ),

    entryConfirmationSeconds: asNumber(
      map.get("entry_confirmation_seconds"),
      DEFAULT_SETTINGS.entryConfirmationSeconds,
    ),

    maxEntryDipPercent: asNumber(
      map.get("max_entry_dip_percent"),
      DEFAULT_SETTINGS.maxEntryDipPercent,
    ),

    maxEntryPumpPercent: asNumber(
      map.get("max_entry_pump_percent"),
      DEFAULT_SETTINGS.maxEntryPumpPercent,
    ),

    maxOpenPositions: asNumber(
      map.get("max_open_positions"),
      DEFAULT_SETTINGS.maxOpenPositions,
    ),

    // Position protection
    initialStopLossPercent: asNumber(
      map.get("initial_stop_loss_percent"),
      DEFAULT_SETTINGS.initialStopLossPercent,
    ),

    trailingStopEnabled: asBoolean(
      map.get("trailing_stop_enabled"),
      DEFAULT_SETTINGS.trailingStopEnabled,
    ),

    // Dump-risk protection
    dumpRiskExitEnabled: asBoolean(
      map.get("dump_risk_exit_enabled"),
      DEFAULT_SETTINGS.dumpRiskExitEnabled,
    ),

    dumpRiskWarningScore: asNumber(
      map.get("dump_risk_warning_score"),
      DEFAULT_SETTINGS.dumpRiskWarningScore,
    ),

    dumpRiskExitScore: asNumber(
      map.get("dump_risk_exit_score"),
      DEFAULT_SETTINGS.dumpRiskExitScore,
    ),

    creatorSellExitEnabled: asBoolean(
      map.get("creator_sell_exit_enabled"),
      DEFAULT_SETTINGS.creatorSellExitEnabled,
    ),

    bundleSellExitEnabled: asBoolean(
      map.get("bundle_sell_exit_enabled"),
      DEFAULT_SETTINGS.bundleSellExitEnabled,
    ),

    liquidityDropExitEnabled: asBoolean(
      map.get("liquidity_drop_exit_enabled"),
      DEFAULT_SETTINGS.liquidityDropExitEnabled,
    ),
  };

  lastLoadedAt = now;

  return cachedSettings;
}

export async function updateAlphaSetting(
  key: string,
  value: unknown,
): Promise<void> {
  const { data, error } = await supabase
    .from("strategy_settings")
    .update({
      value,
      updated_at: new Date().toISOString(),
    })
    .eq("key", key)
    .select("key");

  if (error) {
    throw new Error(
      `Failed to update setting ${key}: ${error.message}`,
    );
  }

  if (!data || data.length === 0) {
    throw new Error(
      `Setting "${key}" does not exist in strategy_settings.`,
    );
  }

  await getAlphaSettings(true);
}