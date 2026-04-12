import { supabase } from '../services/supabase.js';
import { config } from '../config.js';

export async function upsertUser(args: {
  telegramId: string;
  username?: string;
  firstName?: string;
}) {
  const { telegramId, username, firstName } = args;

  const isAdmin = telegramId === config.adminTelegramId;

  const payload: Record<string, unknown> = {
    telegram_id: telegramId,
    username: username ?? null,
    first_name: firstName ?? null,
    updated_at: new Date().toISOString(),
  };

  if (isAdmin) {
    payload.tier = 'admin';
    payload.subscription_status = 'active';
  }

  const { error } = await supabase.from('users').upsert(payload, {
    onConflict: 'telegram_id',
  });

  if (error) throw error;
}

export async function getUserByTelegramId(telegramId: string) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getUserCounts() {
  const { data, error } = await supabase.from('user_counts').select('*').single();
  if (error) throw error;
  return data;
}

export async function getPendingPayments() {
  const { data, error } = await supabase
    .from('pending_payments')
    .select('*')
    .order('requested_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function txHashExists(txHash: string) {
  const { data, error } = await supabase
    .from('payments')
    .select('id')
    .eq('tx_hash', txHash)
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

export async function createPendingPayment(args: {
  telegramId: string;
  username?: string;
  firstName?: string;
  planDays: 15 | 30;
  amountSol: 0.1 | 0.15;
  txHash: string;
}) {
  const { error } = await supabase.from('payments').insert({
    telegram_id: args.telegramId,
    username: args.username ?? null,
    first_name: args.firstName ?? null,
    plan_days: args.planDays,
    amount_sol: args.amountSol,
    tx_hash: args.txHash,
    status: 'pending',
  });

  if (error) throw error;
}

export async function approveLatestPendingPayment(args: {
  telegramId: string;
  planDays: 15 | 30;
  approvedBy: string;
}) {
  const { telegramId, planDays, approvedBy } = args;

  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .select('*')
    .eq('telegram_id', telegramId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (paymentError) throw paymentError;
  if (!payment) throw new Error('No pending payment found.');
  if (payment.plan_days !== planDays) {
    throw new Error(`Pending payment plan mismatch. Found ${payment.plan_days} days.`);
  }

  const now = new Date();
  const paidActiveUntil = new Date(now);
  paidActiveUntil.setDate(paidActiveUntil.getDate() + planDays);

  const { error: updatePaymentError } = await supabase
    .from('payments')
    .update({
      status: 'approved',
      approved_at: now.toISOString(),
      approved_by: approvedBy,
    })
    .eq('id', payment.id);

  if (updatePaymentError) throw updatePaymentError;

  const { error: updateUserError } = await supabase
    .from('users')
    .update({
      tier: 'paid',
      subscription_status: 'active',
      paid_plan_days: planDays,
      paid_started_at: now.toISOString(),
      paid_active_until: paidActiveUntil.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('telegram_id', telegramId);

  if (updateUserError) throw updateUserError;

  return {
    payment,
    paidStartedAt: now.toISOString(),
    paidActiveUntil: paidActiveUntil.toISOString(),
  };
}

export async function rejectLatestPendingPayment(args: {
  telegramId: string;
  approvedBy: string;
  notes?: string;
}) {
  const { telegramId, approvedBy, notes } = args;

  const { data: payment, error } = await supabase
    .from('payments')
    .select('*')
    .eq('telegram_id', telegramId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!payment) throw new Error('No pending payment found.');

  const { error: rejectError } = await supabase
    .from('payments')
    .update({
      status: 'rejected',
      rejected_at: new Date().toISOString(),
      approved_by: approvedBy,
      notes: notes ?? null,
    })
    .eq('id', payment.id);

  if (rejectError) throw rejectError;

  return payment;
}