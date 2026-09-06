import { supabase } from "./supabase.js";

export type AlphaSettings = {
  minScore: number;
  maxAgeMin: number;
  minLiquidity: number;
  maxLiquidity: number;
  minVolume5m: number;
  minBuyRatio: number;
  alertMode: "strict" | "balanced" | "aggressive";
  strategyProfile: "strict" | "balanced" | "aggressive";
  alertsPaused: boolean;
  terminalEnabled: boolean;
  telegramPremiumEnabled: boolean;
  scannerEnabled: boolean;
  aiDecisionEnabled: boolean;
  restartRequested: boolean;
  executionMode: "paper" | "live";
  adminAutoBuyEnabled: boolean;
  adminTradeAmountSol: number;
  entryConfirmationSeconds: number;
  maxEntryDipPercent: number;
  maxEntryPumpPercent: number;
  maxOpenPositions: number;
  initialStopLossPercent: number;
  trailingStopEnabled: boolean;
  dumpRiskExitEnabled: boolean;
  dumpRiskWarningScore: number;
  dumpRiskExitScore: number;
  creatorSellExitEnabled: boolean;
  bundleSellExitEnabled: boolean;
  liquidityDropExitEnabled: boolean;
};

const AUTO_TRADING_PERMANENTLY_DISABLED = true;

const DEFAULT_SETTINGS: AlphaSettings = {
  minScore: 72,
  maxAgeMin: 75,
  minLiquidity: 6000,
  maxLiquidity: 65000,
  minVolume5m: 3000,
  minBuyRatio: 1.4,
  alertMode: "balanced",
  strategyProfile: "balanced",
  alertsPaused: false,
  terminalEnabled: true,
  telegramPremiumEnabled: true,
  scannerEnabled: true,
  aiDecisionEnabled: true,
  restartRequested: false,
  executionMode: "paper",
  adminAutoBuyEnabled: false,
  adminTradeAmountSol: 0.01,
  entryConfirmationSeconds: 30,
  maxEntryDipPercent: 3,
  maxEntryPumpPercent: 12,
  maxOpenPositions: 1,
  initialStopLossPercent: 8,
  trailingStopEnabled: true,
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
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return fallback;
}

function asMode(value: unknown, fallback: "strict" | "balanced" | "aggressive"): "strict" | "balanced" | "aggressive" {
  return value === "strict" || value === "balanced" || value === "aggressive" ? value : fallback;
}

function asExecutionMode(value: unknown, fallback: "paper" | "live"): "paper" | "live" {
  if (typeof value === "string") {
    const normalised = value.replace(/^"+|"+$/g, "").trim().toLowerCase();
    if (normalised === "paper" || normalised === "live") return normalised;
  }
  return fallback;
}

export async function getAlphaSettings(forceRefresh = false): Promise<AlphaSettings> {
  const now = Date.now();
  if (!forceRefresh && now - lastLoadedAt < CACHE_MS) return cachedSettings;

  const { data, error } = await supabase.from("strategy_settings").select("key,value");
  if (error) {
    console.error("⚠️ Failed to load strategy settings:", error.message);
    return { ...cachedSettings, adminAutoBuyEnabled: false, executionMode: "paper" };
  }

  const map = new Map<string, unknown>();
  for (const row of data ?? []) map.set(row.key, row.value);

  cachedSettings = {
    minScore: asNumber(map.get("min_score"), DEFAULT_SETTINGS.minScore),
    maxAgeMin: asNumber(map.get("max_age_min"), DEFAULT_SETTINGS.maxAgeMin),
    minLiquidity: asNumber(map.get("min_liquidity"), DEFAULT_SETTINGS.minLiquidity),
    maxLiquidity: asNumber(map.get("max_liquidity"), DEFAULT_SETTINGS.maxLiquidity),
    minVolume5m: asNumber(map.get("min_volume_5m"), DEFAULT_SETTINGS.minVolume5m),
    minBuyRatio: asNumber(map.get("min_buy_ratio"), DEFAULT_SETTINGS.minBuyRatio),
    alertMode: asMode(map.get("alert_mode"), DEFAULT_SETTINGS.alertMode),
    strategyProfile: asMode(map.get("strategy_profile"), DEFAULT_SETTINGS.strategyProfile),
    alertsPaused: asBoolean(map.get("alerts_paused"), DEFAULT_SETTINGS.alertsPaused),
    terminalEnabled: asBoolean(map.get("terminal_enabled"), DEFAULT_SETTINGS.terminalEnabled),
    telegramPremiumEnabled: asBoolean(map.get("telegram_premium_enabled"), DEFAULT_SETTINGS.telegramPremiumEnabled),
    scannerEnabled: asBoolean(map.get("scanner_enabled"), DEFAULT_SETTINGS.scannerEnabled),
    aiDecisionEnabled: asBoolean(map.get("ai_decision_enabled"), DEFAULT_SETTINGS.aiDecisionEnabled),
    restartRequested: asBoolean(map.get("restart_requested"), DEFAULT_SETTINGS.restartRequested),
    executionMode: AUTO_TRADING_PERMANENTLY_DISABLED ? "paper" : asExecutionMode(map.get("execution_mode"), DEFAULT_SETTINGS.executionMode),
    adminAutoBuyEnabled: AUTO_TRADING_PERMANENTLY_DISABLED ? false : asBoolean(map.get("admin_auto_buy_enabled"), DEFAULT_SETTINGS.adminAutoBuyEnabled),
    adminTradeAmountSol: asNumber(map.get("admin_trade_amount_sol"), DEFAULT_SETTINGS.adminTradeAmountSol),
    entryConfirmationSeconds: asNumber(map.get("entry_confirmation_seconds"), DEFAULT_SETTINGS.entryConfirmationSeconds),
    maxEntryDipPercent: asNumber(map.get("max_entry_dip_percent"), DEFAULT_SETTINGS.maxEntryDipPercent),
    maxEntryPumpPercent: asNumber(map.get("max_entry_pump_percent"), DEFAULT_SETTINGS.maxEntryPumpPercent),
    maxOpenPositions: asNumber(map.get("max_open_positions"), DEFAULT_SETTINGS.maxOpenPositions),
    initialStopLossPercent: asNumber(map.get("initial_stop_loss_percent"), DEFAULT_SETTINGS.initialStopLossPercent),
    trailingStopEnabled: asBoolean(map.get("trailing_stop_enabled"), DEFAULT_SETTINGS.trailingStopEnabled),
    dumpRiskExitEnabled: asBoolean(map.get("dump_risk_exit_enabled"), DEFAULT_SETTINGS.dumpRiskExitEnabled),
    dumpRiskWarningScore: asNumber(map.get("dump_risk_warning_score"), DEFAULT_SETTINGS.dumpRiskWarningScore),
    dumpRiskExitScore: asNumber(map.get("dump_risk_exit_score"), DEFAULT_SETTINGS.dumpRiskExitScore),
    creatorSellExitEnabled: asBoolean(map.get("creator_sell_exit_enabled"), DEFAULT_SETTINGS.creatorSellExitEnabled),
    bundleSellExitEnabled: asBoolean(map.get("bundle_sell_exit_enabled"), DEFAULT_SETTINGS.bundleSellExitEnabled),
    liquidityDropExitEnabled: asBoolean(map.get("liquidity_drop_exit_enabled"), DEFAULT_SETTINGS.liquidityDropExitEnabled),
  };

  lastLoadedAt = now;
  return cachedSettings;
}

export async function updateAlphaSetting(key: string, value: unknown): Promise<void> {
  if (AUTO_TRADING_PERMANENTLY_DISABLED && (key === "admin_auto_buy_enabled" || key === "execution_mode")) {
    if (key === "admin_auto_buy_enabled" && asBoolean(value, false) === false) return;
    if (key === "execution_mode" && asExecutionMode(value, "paper") === "paper") return;
    throw new Error("Automatic trading is disabled in AlphaOS alert-only mode.");
  }

  const { data, error } = await supabase.from("strategy_settings").update({
    value,
    updated_at: new Date().toISOString(),
  }).eq("key", key).select("key");

  if (error) throw new Error(`Failed to update setting ${key}: ${error.message}`);
  if (!data || data.length === 0) throw new Error(`Setting "${key}" does not exist in strategy_settings.`);
  await getAlphaSettings(true);
}
