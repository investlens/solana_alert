import { supabase } from './supabase.js';

export type StrategyDefaultAction =
  | 'BUY'
  | 'CHECK_ENTRY'
  | 'TRACK'
  | 'WATCH'
  | 'EXIT'
  | 'DETAILS'
  | string;

export type StrategyDefinition = {
  strategy_key: string;
  name: string;
  chain: string;
  category: string;
  enabled: boolean;
  default_action: StrategyDefaultAction;
};

export type UserStrategyPreference = {
  strategy_key: string;
  enabled: boolean;
};

export const DEX_PAID_STRATEGY_KEY = 'DEX_PAID';
export const X_REPUTED_MENTION_STRATEGY_KEY = 'X_REPUTED_MENTION';

const strategyStateCache = new Map<string, boolean>();
const userPreferenceCache = new Map<string, boolean>();
const preferenceKey = (telegramId: string, strategyKey: string) => `${telegramId}:${strategyKey}`;

export function defaultStrategyEnabledForUser(strategyKey: string): boolean {
  // DEX_PAID and other core strategies are fail-open for alert continuity.
  // X mentions remain opt-in to avoid notification noise during a database outage.
  return strategyKey !== X_REPUTED_MENTION_STRATEGY_KEY;
}

export async function getEnabledStrategies(): Promise<StrategyDefinition[]> {
  const { data, error } = await supabase.from('strategy_registry')
    .select('strategy_key,name,chain,category,enabled,default_action')
    .eq('enabled', true).order('chain').order('category').order('name');
  if (error) { console.error('[StrategyService] Registry load failed:', error); throw error; }
  const rows = (data ?? []) as StrategyDefinition[];
  for (const row of rows) strategyStateCache.set(row.strategy_key, Boolean(row.enabled));
  return rows;
}

export async function getAllStrategies(): Promise<StrategyDefinition[]> {
  const { data, error } = await supabase.from('strategy_registry')
    .select('strategy_key,name,chain,category,enabled,default_action')
    .order('chain').order('category').order('name');
  if (error) { console.error('[StrategyService] Registry load failed:', error); throw error; }
  const rows = (data ?? []) as StrategyDefinition[];
  for (const row of rows) strategyStateCache.set(row.strategy_key, Boolean(row.enabled));
  return rows;
}

export async function getUserStrategyPreferences(telegramId: string): Promise<Map<string, boolean>> {
  const { data, error } = await supabase.from('user_strategy_preferences')
    .select('strategy_key,enabled').eq('telegram_id', telegramId);
  if (error) { console.error('[StrategyService] Preference load failed:', { telegramId, error }); throw error; }
  const preferences = new Map<string, boolean>();
  for (const row of (data ?? []) as UserStrategyPreference[]) {
    const enabled = Boolean(row.enabled);
    preferences.set(row.strategy_key, enabled);
    userPreferenceCache.set(preferenceKey(telegramId, row.strategy_key), enabled);
  }
  return preferences;
}

export async function isStrategyEnabledForUser(telegramId: string, strategyKey: string): Promise<boolean> {
  try {
    const { data: strategy, error: strategyError } = await supabase.from('strategy_registry')
      .select('enabled').eq('strategy_key', strategyKey).maybeSingle();
    if (strategyError) throw strategyError;
    const strategyEnabled = Boolean(strategy?.enabled);
    strategyStateCache.set(strategyKey, strategyEnabled);
    if (!strategyEnabled) return false;

    const { data: preference, error: preferenceError } = await supabase.from('user_strategy_preferences')
      .select('enabled').eq('telegram_id', telegramId).eq('strategy_key', strategyKey).maybeSingle();
    if (preferenceError) throw preferenceError;
    if (!preference) return defaultStrategyEnabledForUser(strategyKey);

    const enabled = Boolean(preference.enabled);
    userPreferenceCache.set(preferenceKey(telegramId, strategyKey), enabled);
    return enabled;
  } catch (error) {
    const cachedStrategy = strategyStateCache.get(strategyKey);
    const cachedPreference = userPreferenceCache.get(preferenceKey(telegramId, strategyKey));
    const enabled = cachedStrategy === false
      ? false
      : cachedPreference ?? defaultStrategyEnabledForUser(strategyKey);

    console.warn('[StrategyService] Database unavailable; using resilient strategy fallback.', {
      telegramId,
      strategyKey,
      enabled,
      reason: error instanceof Error ? error.message : String(error),
    });
    return enabled;
  }
}

export async function setUserStrategyEnabled(args: { telegramId: string; strategyKey: string; enabled: boolean }): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from('user_strategy_preferences').upsert({
    telegram_id: args.telegramId, strategy_key: args.strategyKey, enabled: args.enabled, updated_at: now,
  }, { onConflict: 'telegram_id,strategy_key' });
  if (error) { console.error('[StrategyService] Preference update failed:', { ...args, error }); throw error; }
  userPreferenceCache.set(preferenceKey(args.telegramId, args.strategyKey), args.enabled);
}

export async function toggleUserStrategy(args: { telegramId: string; strategyKey: string }): Promise<boolean> {
  const current = await isStrategyEnabledForUser(args.telegramId, args.strategyKey);
  const next = !current;
  await setUserStrategyEnabled({ ...args, enabled: next });
  return next;
}

export async function getUserStrategyState(telegramId: string): Promise<Array<StrategyDefinition & { user_enabled: boolean }>> {
  const strategies = await getAllStrategies();
  const preferences = await getUserStrategyPreferences(telegramId);
  return strategies.map(strategy => ({
    ...strategy,
    user_enabled: strategy.enabled && (preferences.get(strategy.strategy_key) ?? defaultStrategyEnabledForUser(strategy.strategy_key)),
  }));
}
