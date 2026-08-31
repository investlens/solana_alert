import { supabase } from './supabase.js';

export const X_ACCOUNT_TIERS = ['HIGH_ALPHA', 'REPUTED', 'WATCH'] as const;
export type XAccountTier = typeof X_ACCOUNT_TIERS[number];

export type XReputedAccount = {
  id: number;
  handle: string;
  display_name: string | null;
  enabled: boolean;
  tier: XAccountTier;
  source: string;
  source_rank: number | null;
  source_metrics: Record<string, unknown>;
  notes: string | null;
  added_by: string | null;
  created_at: string;
  updated_at: string;
};

export function normalizeXHandle(value: string): string {
  const normalized = value.trim().replace(/^@+/, '').toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(normalized)) {
    throw new Error('X handle must contain 1-15 letters, numbers, or underscores');
  }
  return normalized;
}

export async function addXReputedAccount(args: {
  handle: string;
  addedBy: string;
  displayName?: string | null;
}): Promise<XReputedAccount> {
  const handle = normalizeXHandle(args.handle);
  const { data, error } = await supabase.from('x_reputed_accounts').insert({
    handle,
    display_name: args.displayName?.trim() || null,
    enabled: true,
    tier: 'WATCH',
    source: 'ADMIN_MANUAL',
    source_metrics: {},
    added_by: args.addedBy,
    updated_at: new Date().toISOString(),
  }).select('*').single();
  if (error) {
    if (error.code === '23505') throw new Error(`@${handle} is already on the watchlist`);
    throw error;
  }
  return data as XReputedAccount;
}

export async function getXReputedAccountByHandle(handle: string): Promise<XReputedAccount | null> {
  const normalized = normalizeXHandle(handle);
  const { data, error } = await supabase.from('x_reputed_accounts').select('*')
    .eq('handle', normalized).maybeSingle();
  if (error) throw error;
  return data as XReputedAccount | null;
}

export async function getXReputedAccount(id: number): Promise<XReputedAccount | null> {
  const { data, error } = await supabase.from('x_reputed_accounts').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as XReputedAccount | null;
}

export async function listXReputedAccounts(page = 0, pageSize = 10): Promise<{
  accounts: XReputedAccount[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const safeSize = Math.max(1, Math.min(10, Math.trunc(pageSize)));
  const safePage = Math.max(0, Math.trunc(page));
  const from = safePage * safeSize;
  const { data, error, count } = await supabase.from('x_reputed_accounts').select('*', { count: 'exact' })
    .order('handle').range(from, from + safeSize - 1);
  if (error) throw error;
  return { accounts: (data ?? []) as XReputedAccount[], total: count ?? 0, page: safePage, pageSize: safeSize };
}

export async function getXReputedAccountStats(): Promise<{ total: number; enabled: number }> {
  const [{ count: total, error: totalError }, { count: enabled, error: enabledError }] = await Promise.all([
    supabase.from('x_reputed_accounts').select('id', { count: 'exact', head: true }),
    supabase.from('x_reputed_accounts').select('id', { count: 'exact', head: true }).eq('enabled', true),
  ]);
  if (totalError) throw totalError;
  if (enabledError) throw enabledError;
  return { total: total ?? 0, enabled: enabled ?? 0 };
}

export async function setXReputedAccountEnabled(id: number, enabled: boolean): Promise<void> {
  const { data, error } = await supabase.from('x_reputed_accounts')
    .update({ enabled, updated_at: new Date().toISOString() }).eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('X account not found');
}

export async function setXReputedAccountTier(id: number, tier: XAccountTier): Promise<void> {
  if (!X_ACCOUNT_TIERS.includes(tier)) throw new Error('Invalid X account tier');
  const { data, error } = await supabase.from('x_reputed_accounts')
    .update({ tier, updated_at: new Date().toISOString() }).eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('X account not found');
}

export async function removeXReputedAccount(id: number): Promise<void> {
  const { data, error } = await supabase.from('x_reputed_accounts').delete().eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('X account not found');
}
