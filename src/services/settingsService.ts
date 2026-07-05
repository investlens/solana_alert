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
};

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
};

let cachedSettings: AlphaSettings = DEFAULT_SETTINGS;
let lastLoadedAt = 0;

const CACHE_MS = 15_000;

function asNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return fallback;
}

function asMode(
  value: unknown,
  fallback: "strict" | "balanced" | "aggressive"
): "strict" | "balanced" | "aggressive" {
  if (value === "strict" || value === "balanced" || value === "aggressive") {
    return value;
  }
  return fallback;
}

export async function getAlphaSettings(forceRefresh = false): Promise<AlphaSettings> {
  const now = Date.now();

  if (!forceRefresh && now - lastLoadedAt < CACHE_MS) {
    return cachedSettings;
  }

  const { data, error } = await supabase
    .from("strategy_settings")
    .select("key,value");

  if (error) {
    console.error("⚠️ Failed to load strategy settings:", error.message);
    return cachedSettings;
  }

  const map = new Map<string, unknown>();

  for (const row of data || []) {
    map.set(row.key, row.value);
  }

  cachedSettings = {
    minScore: asNumber(map.get("min_score"), DEFAULT_SETTINGS.minScore),
    maxAgeMin: asNumber(map.get("max_age_min"), DEFAULT_SETTINGS.maxAgeMin),
    minLiquidity: asNumber(map.get("min_liquidity"), DEFAULT_SETTINGS.minLiquidity),
    maxLiquidity: asNumber(map.get("max_liquidity"), DEFAULT_SETTINGS.maxLiquidity),
    minVolume5m: asNumber(map.get("min_volume_5m"), DEFAULT_SETTINGS.minVolume5m),
    minBuyRatio: asNumber(map.get("min_buy_ratio"), DEFAULT_SETTINGS.minBuyRatio),

    alertMode: asMode(map.get("alert_mode"), DEFAULT_SETTINGS.alertMode),
    strategyProfile: asMode(
      map.get("strategy_profile"),
      DEFAULT_SETTINGS.strategyProfile
    ),

    alertsPaused: asBoolean(map.get("alerts_paused"), DEFAULT_SETTINGS.alertsPaused),
    terminalEnabled: asBoolean(
      map.get("terminal_enabled"),
      DEFAULT_SETTINGS.terminalEnabled
    ),
    telegramPremiumEnabled: asBoolean(
      map.get("telegram_premium_enabled"),
      DEFAULT_SETTINGS.telegramPremiumEnabled
    ),
    scannerEnabled: asBoolean(
      map.get("scanner_enabled"),
      DEFAULT_SETTINGS.scannerEnabled
    ),
    aiDecisionEnabled: asBoolean(
      map.get("ai_decision_enabled"),
      DEFAULT_SETTINGS.aiDecisionEnabled
    ),
    restartRequested: asBoolean(
      map.get("restart_requested"),
      DEFAULT_SETTINGS.restartRequested
    ),
  };

  lastLoadedAt = now;
  return cachedSettings;
}

export async function updateAlphaSetting(key: string, value: unknown) {
  const { error } = await supabase
    .from("strategy_settings")
    .update({
      value,
      updated_at: new Date().toISOString(),
    })
    .eq("key", key);

  if (error) {
    throw new Error(`Failed to update setting ${key}: ${error.message}`);
  }

  await getAlphaSettings(true);
}