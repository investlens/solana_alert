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

export async function getEnabledStrategies(): Promise<
  StrategyDefinition[]
> {
  const { data, error } = await supabase
    .from('strategy_registry')
    .select(
      'strategy_key,name,chain,category,enabled,default_action',
    )
    .eq('enabled', true)
    .order('chain')
    .order('category')
    .order('name');

  if (error) {
    console.error('[StrategyService] Registry load failed:', error);
    throw error;
  }

  return (data ?? []) as StrategyDefinition[];
}

export async function getAllStrategies(): Promise<
  StrategyDefinition[]
> {
  const { data, error } = await supabase
    .from('strategy_registry')
    .select(
      'strategy_key,name,chain,category,enabled,default_action',
    )
    .order('chain')
    .order('category')
    .order('name');

  if (error) {
    console.error('[StrategyService] Registry load failed:', error);
    throw error;
  }

  return (data ?? []) as StrategyDefinition[];
}

export async function getUserStrategyPreferences(
  telegramId: string,
): Promise<Map<string, boolean>> {
  const { data, error } = await supabase
    .from('user_strategy_preferences')
    .select('strategy_key,enabled')
    .eq('telegram_id', telegramId);

  if (error) {
    console.error(
      '[StrategyService] Preference load failed:',
      {
        telegramId,
        error,
      },
    );

    throw error;
  }

  const preferences = new Map<string, boolean>();

  for (const row of (data ?? []) as UserStrategyPreference[]) {
    preferences.set(
      row.strategy_key,
      Boolean(row.enabled),
    );
  }

  return preferences;
}

/*
 * Strategy behaviour:
 *
 * 1. Globally disabled strategy = OFF for everyone.
 * 2. User preference exists = honour preference.
 * 3. No user preference = enabled by default.
 */
export async function isStrategyEnabledForUser(
  telegramId: string,
  strategyKey: string,
): Promise<boolean> {
  const { data: strategy, error: strategyError } =
    await supabase
      .from('strategy_registry')
      .select('enabled')
      .eq('strategy_key', strategyKey)
      .maybeSingle();

  if (strategyError) {
    throw strategyError;
  }

  if (!strategy?.enabled) {
    return false;
  }

  const { data: preference, error: preferenceError } =
    await supabase
      .from('user_strategy_preferences')
      .select('enabled')
      .eq('telegram_id', telegramId)
      .eq('strategy_key', strategyKey)
      .maybeSingle();

  if (preferenceError) {
    throw preferenceError;
  }

  if (!preference) {
    return true;
  }

  return Boolean(preference.enabled);
}

export async function setUserStrategyEnabled(args: {
  telegramId: string;
  strategyKey: string;
  enabled: boolean;
}): Promise<void> {
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('user_strategy_preferences')
    .upsert(
      {
        telegram_id: args.telegramId,
        strategy_key: args.strategyKey,
        enabled: args.enabled,
        updated_at: now,
      },
      {
        onConflict: 'telegram_id,strategy_key',
      },
    );

  if (error) {
    console.error(
      '[StrategyService] Preference update failed:',
      {
        ...args,
        error,
      },
    );

    throw error;
  }
}

export async function toggleUserStrategy(args: {
  telegramId: string;
  strategyKey: string;
}): Promise<boolean> {
  const current =
    await isStrategyEnabledForUser(
      args.telegramId,
      args.strategyKey,
    );

  const next = !current;

  await setUserStrategyEnabled({
    ...args,
    enabled: next,
  });

  return next;
}

export async function getUserStrategyState(
  telegramId: string,
): Promise<
  Array<
    StrategyDefinition & {
      user_enabled: boolean;
    }
  >
> {
  const strategies =
    await getAllStrategies();

  const preferences =
    await getUserStrategyPreferences(
      telegramId,
    );

  return strategies.map(
    strategy => ({
      ...strategy,

      user_enabled:
        strategy.enabled &&
        (
          preferences.get(
            strategy.strategy_key,
          ) ?? true
        ),
    }),
  );
}
