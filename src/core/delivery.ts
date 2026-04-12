import { supabase } from '../services/supabase.js';

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

  if (error) throw error;
  return (data ?? []) as DeliverableUser[];
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
  return data;
}

export async function createAlertDelivery(args: {
  alertId: string;
  telegramId: string;
  tierAtDelivery: 'admin' | 'paid' | 'free';
  deliveryType: 'instant' | 'paid_delay' | 'free_trial_fast' | 'free_delayed';
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