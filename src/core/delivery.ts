import { supabase } from '../services/supabase.js';
import {
  eventEngine,
} from '../services/eventEngine.js';

export type DeliverableUser = {
  telegram_id: string;
  username: string | null;
  first_name: string | null;
  tier: 'admin' | 'paid' | 'free';
  subscription_status: 'none' | 'active' | 'expired';
  free_trial_used: number;
  free_trial_limit: number;
  paid_active_until: string | null;
  is_blocked: boolean;
};

export async function expireDueSubscriptions() {
  const { error } = await supabase.rpc('expire_due_subscriptions');
  if (error) throw error;
}

export async function getDeliverableUsers(): Promise<DeliverableUser[]> {
  const { data, error } = await supabase
    .from('users')
    .select(
      'telegram_id, username, first_name, tier, subscription_status, free_trial_used, free_trial_limit, paid_active_until, is_blocked'
    )
    .eq('is_blocked', false);

  if (error) {
    console.error('getDeliverableUsers failed:', error);
    throw error;
  }

  const users = (data ?? []) as DeliverableUser[];

  console.log('deliverable users loaded:', {
    count: users.length,
    users: users.map((user) => ({
      telegramId: user.telegram_id,
      username: user.username,
      firstName: user.first_name,
      tier: user.tier,
      subscriptionStatus: user.subscription_status,
      isBlocked: user.is_blocked,
    })),
  });

  return users;
}

export async function incrementFreeTrialUsed(telegramId: string) {
  const { data, error } = await supabase
    .from('users')
    .select('free_trial_used')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (error) throw error;
  const current = Number(data?.free_trial_used ?? 0);

  const { error: updateError } = await supabase
    .from('users')
    .update({
      free_trial_used: current + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('telegram_id', telegramId);

  if (updateError) throw updateError;
}

async function createAlertOutcome(args: {
  alertId: string;
  chain: string;
  tokenAddress: string;
  pairAddress?: string | null;
  symbol?: string | null;
  name?: string | null;
  entryPrice?: number | null;
  scoreAtAlert: number;
  riskAtAlert: string;
  actionAtAlert: string;
}) {
  const now = new Date().toISOString();

  console.log(
      "[createAlertOutcome] Creating outcome for",
      args.symbol,
      args.alertId
    );

  const { error } = await supabase
    .from("alert_outcomes")
    .insert({
      alert_id: args.alertId,
      chain: args.chain,
      token_address: args.tokenAddress,
      pair_address: args.pairAddress ?? null,
      symbol: args.symbol ?? null,
      name: args.name ?? null,

      entry_price: args.entryPrice ?? 0,
      current_price: args.entryPrice ?? 0,
      highest_price: args.entryPrice ?? 0,
      lowest_price: args.entryPrice ?? 0,

      roi_current: 0,
      roi_peak: 0,
      roi_low: 0,
      max_drawdown: 0,

      alert_score: args.scoreAtAlert,
      alert_risk: args.riskAtAlert,
      alert_action: args.actionAtAlert,

      status: "ACTIVE",

      alerted_at: now,
      created_at: now,
      updated_at: now,
      last_checked_at: now,
    });

  if (error) {
    console.error("========== ALERT OUTCOME INSERT FAILED ==========");
    console.error(error);
    console.error("Payload:", {
      alertId: args.alertId,
      chain: args.chain,
      tokenAddress: args.tokenAddress,
      pairAddress: args.pairAddress,
      symbol: args.symbol,
      name: args.name,
      entryPrice: args.entryPrice,
      score: args.scoreAtAlert,
      risk: args.riskAtAlert,
      action: args.actionAtAlert,
    });
    console.error("===============================================");
  }
}

export async function createAlertRecord(args: {
  chain: string;
  tokenAddress: string;
  pairAddress?: string | null;
  symbol?: string | null;
  name?: string | null;
  scoreAtAlert: number;
  riskAtAlert: string;
  actionAtAlert: string;
  alertPrice?: number | null;
  liquidityAtAlert?: number | null;
  buys5mAtAlert?: number | null;
  sells5mAtAlert?: number | null;
  volume5mAtAlert?: number | null;
}) {
  const { data, error } = await supabase
    .from('alerts')
    .insert({
      chain: args.chain,
      token_address: args.tokenAddress,
      pair_address: args.pairAddress ?? null,
      symbol: args.symbol ?? null,
      name: args.name ?? null,
      score_at_alert: args.scoreAtAlert,
      risk_at_alert: args.riskAtAlert,
      action_at_alert: args.actionAtAlert,
      alert_price: args.alertPrice ?? null,
      liquidity_at_alert: args.liquidityAtAlert ?? null,
      buys5m_at_alert: args.buys5mAtAlert ?? null,
      sells5m_at_alert: args.sells5mAtAlert ?? null,
      volume5m_at_alert: args.volume5mAtAlert ?? null,
    })
    .select('id')
    .single();

  if (error) throw error;

  await createAlertOutcome({
    alertId: data.id,
    chain: args.chain,
    tokenAddress: args.tokenAddress,
    pairAddress: args.pairAddress,
    symbol: args.symbol,
    name: args.name,
    entryPrice: args.alertPrice,
    scoreAtAlert: args.scoreAtAlert,
    riskAtAlert: args.riskAtAlert,
    actionAtAlert: args.actionAtAlert,
  });

  try {
    await eventEngine.emit({
      eventType: 'ALERT_GENERATED',

      token: {
        chain: args.chain,
        tokenAddress: args.tokenAddress,
      },

      source: 'ALERT_PIPELINE',

      severity:
        args.actionAtAlert.toUpperCase() === 'BUY'
          ? 'NOTICE'
          : 'INFO',

      deduplicationKey: [
        'alert',
        data.id,
        args.actionAtAlert.toUpperCase(),
      ].join(':'),

      deduplicationWindowSeconds: 24 * 60 * 60,

      payload: {
        alertId: data.id,

        pairAddress: args.pairAddress ?? null,

        symbol: args.symbol ?? null,
        name: args.name ?? null,

        score: args.scoreAtAlert,
        risk: args.riskAtAlert,
        action: args.actionAtAlert,

        alertPrice: args.alertPrice ?? null,
        liquidity: args.liquidityAtAlert ?? null,
        buys5m: args.buys5mAtAlert ?? null,
        sells5m: args.sells5mAtAlert ?? null,
        volume5m: args.volume5mAtAlert ?? null,
      },
    });
  } catch (error) {
    console.warn(
      '[Delivery] ALERT_GENERATED event failed:',
      error,
    );
  }

  return data;
}

export async function createAlertDelivery(args: {
  alertId: string;
  chain: string;
  tokenAddress: string;
  telegramId: string;
  tierAtDelivery: 'admin' | 'paid' | 'free';
  deliveryType:
    | 'instant'
    | 'paid_delay'
    | 'free_trial_fast'
    | 'free_delayed';
  delaySeconds: number;
}) {
  const { error } = await supabase.from('alert_deliveries').insert({
    alert_id: args.alertId,
    telegram_id: args.telegramId,
    tier_at_delivery: args.tierAtDelivery,
    delivery_type: args.deliveryType,
    delay_seconds: args.delaySeconds,
  });

  if (error) throw error;

  try {
    await eventEngine.emit({
      eventType: 'ALERT_SENT',

      token: {
        chain: args.chain,
        tokenAddress: args.tokenAddress,
      },

      source: 'TELEGRAM',

      severity: 'INFO',

      deduplicationKey: [
        'delivery',
        args.alertId,
        args.telegramId,
        args.deliveryType,
      ].join(':'),

      deduplicationWindowSeconds: 24 * 60 * 60,

      payload: {
        alertId: args.alertId,
        telegramId: args.telegramId,

        tier: args.tierAtDelivery,

        deliveryType: args.deliveryType,

        delaySeconds: args.delaySeconds,
      },
    });
  } catch (error) {
    console.warn(
      '[Delivery] ALERT_SENT event failed:',
      error,
    );
  }

}

export async function hasAlertDelivery(args: {
  alertId: string;
  telegramId: string;
}) {
  const { data, error } = await supabase
    .from('alert_deliveries')
    .select('id')
    .eq('alert_id', args.alertId)
    .eq('telegram_id', args.telegramId)
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

export async function getAlertDeliveries(
  alertId: string,
): Promise<Array<{
  telegram_id: string;
  tier_at_delivery: 'admin' | 'paid' | 'free';
}>> {
  const { data, error } = await supabase
    .from('alert_deliveries')
    .select('telegram_id, tier_at_delivery')
    .eq('alert_id', alertId);

  if (error) {
    console.error('getAlertDeliveries failed:', {
      alertId,
      error,
    });

    throw error;
  }

  return (data ?? []) as Array<{
    telegram_id: string;
    tier_at_delivery: 'admin' | 'paid' | 'free';
  }>;
}

export async function markTelegramUserBlocked(
  telegramId: string
): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({
      is_blocked: true,
      updated_at: new Date().toISOString(),
    })
    .eq('telegram_id', telegramId);

  if (error) {
    console.error('markTelegramUserBlocked failed:', {
      telegramId,
      error,
    });
  }
}

export async function updateAlertPerformance(args: {
  alertId: string;
  currentPrice?: number | null;
}) {
  const { alertId, currentPrice } = args;

  if (currentPrice == null || !Number.isFinite(currentPrice)) return;

  const { data: alert, error: fetchError } = await supabase
    .from('alerts')
    .select('alert_price, high_price_after_alert')
    .eq('id', alertId)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!alert?.alert_price) return;

  const alertPrice = Number(alert.alert_price);
  const existingHigh = alert.high_price_after_alert != null
    ? Number(alert.high_price_after_alert)
    : null;

  const newHigh =
    existingHigh == null ? currentPrice : Math.max(existingHigh, currentPrice);

  const roiNow = ((currentPrice - alertPrice) / alertPrice) * 100;
  const roiHigh = ((newHigh - alertPrice) / alertPrice) * 100;

  const { error: updateError } = await supabase
    .from('alerts')
    .update({
      current_price: currentPrice,
      high_price_after_alert: newHigh,
      roi_now: roiNow,
      roi_high: roiHigh,
      updated_at: new Date().toISOString(),
    })
    .eq('id', alertId);

  if (updateError) throw updateError;
}