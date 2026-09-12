import { supabase } from '../services/supabase.js';
import { eventEngine } from '../services/eventEngine.js';
import { runtimeDeliverableUsers } from '../services/runtimeSubscriberRegistry.js';

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

let lastGoodDeliverableUsers: DeliverableUser[] = [];

export async function expireDueSubscriptions() {
  const { error } = await supabase.rpc('expire_due_subscriptions');
  if (error) throw error;
}

export async function getDeliverableUsers(): Promise<DeliverableUser[]> {
  const testingRealtime = process.env.TESTING_REALTIME_ALERTS === 'true';

  try {
    const { data, error } = await supabase
      .from('users')
      .select(
        'telegram_id, username, first_name, tier, subscription_status, free_trial_used, free_trial_limit, paid_active_until, is_blocked'
      )
      .eq('is_blocked', false);

    if (error) throw error;

    const users = (data ?? []) as DeliverableUser[];
    lastGoodDeliverableUsers = users;

    console.log('deliverable users loaded:', { count: users.length });
    return users;
  } catch (error) {
    const runtime = runtimeDeliverableUsers({ allRealtime: testingRealtime }) as DeliverableUser[];
    const merged = new Map<string, DeliverableUser>();

    for (const user of lastGoodDeliverableUsers) merged.set(String(user.telegram_id), user);
    for (const user of runtime) merged.set(String(user.telegram_id), user);

    const fallback = [...merged.values()];
    console.warn('[Delivery] Subscriber DB read failed; using resilient recipient cache.', {
      cached: lastGoodDeliverableUsers.length,
      runtime: runtime.length,
      total: fallback.length,
      reason: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
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
  const { error } = await supabase.from('alert_outcomes').insert({
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
    status: 'ACTIVE',
    alerted_at: now,
    created_at: now,
    updated_at: now,
    last_checked_at: now,
  });
  if (error) throw error;
}

export async function createAlertRecord(args: any) {
  const { data, error } = await supabase.from('alerts').insert(args).select('id').single();
  if (error) throw error;
  return data?.id as string;
}

export async function createAlertDelivery(args: any) {
  const payload = {
    alert_id: args.alertId,
    chain: args.chain,
    token_address: args.tokenAddress,
    telegram_id: args.telegramId,
    tier_at_delivery: args.tierAtDelivery,
    delivery_type: args.deliveryType,
    delay_seconds: args.delaySeconds,
    delivered_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('alert_deliveries').insert(payload);
  if (error) throw error;
  eventEngine.emit('alert_delivery_created', payload);
}

export async function hasAlertDelivery(args: { alertId: string; telegramId: string }) {
  const { data, error } = await supabase.from('alert_deliveries').select('id').eq('alert_id', args.alertId).eq('telegram_id', args.telegramId).limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

export async function updateAlertPerformance(args: { alertId: string; currentPrice: number }) {
  const { error } = await supabase.from('alerts').update({ current_price: args.currentPrice, updated_at: new Date().toISOString() }).eq('id', args.alertId);
  if (error) throw error;
}

export { createAlertOutcome };
