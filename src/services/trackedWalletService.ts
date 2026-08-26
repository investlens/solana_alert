import {
  supabase,
} from './supabase.js';
import { requireWalletAddress, walletFamilyHasLiveMonitoring } from './walletAddress.js';

export type TrackedWallet = {
  id: number;

  telegram_id: string;

  wallet_address: string;

  chain: string;

  label: string | null;

  is_active: boolean;

  alerts_enabled: boolean;

  created_at: string;

  updated_at: string;
};

function normalizeAddress(
  address: string,
): string {
  return address.trim();
}

export function resolveTrackedWalletChain(
  family: 'solana' | 'evm',
  requested?: string,
): 'solana' | 'evm' | 'robinhood' {
  const requestedChain = String(requested ?? family).trim().toLowerCase();
  if (family === 'solana') {
    if (requestedChain !== 'solana') throw new Error('Wallet family does not match requested chain');
    return 'solana';
  }
  if (!['evm', 'robinhood'].includes(requestedChain)) {
    throw new Error('Wallet family does not match requested chain');
  }
  return requestedChain as 'evm' | 'robinhood';
}

export async function
getTrackedWalletsForUser(
  telegramId: string,
): Promise<TrackedWallet[]> {
  const {
    data,
    error,
  } =
    await supabase
      .from(
        'user_tracked_wallets',
      )
      .select(`
        id,
        telegram_id,
        wallet_address,
        chain,
        label,
        is_active,
        alerts_enabled,
        created_at,
        updated_at
      `)
      .eq(
        'telegram_id',
        telegramId,
      )
      .order(
        'created_at',
        {
          ascending:
            true,
        },
      );

  if (error) {
    throw error;
  }

  return (
    data ??
    []
  ) as TrackedWallet[];
}

export async function getLatestWalletActivityForUser(telegramId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('wallet_activity_deliveries')
    .select('wallet_address,created_at').eq('telegram_id', telegramId)
    .order('created_at', { ascending: false }).limit(250);
  if (error) throw error;
  const latest = new Map<string, string>();
  for (const row of data ?? []) { const key = String(row.wallet_address).toLowerCase(); if (!latest.has(key)) latest.set(key, String(row.created_at)); }
  return latest;
}

export async function
getActiveTrackedWalletAddresses(
  chain:
    string =
    'solana',
): Promise<string[]> {
  const {
    data,
    error,
  } =
    await supabase
      .from(
        'user_tracked_wallets',
      )
      .select(
        'wallet_address',
      )
      .eq(
        'chain',
        chain,
      )
      .eq(
        'is_active',
        true,
      );

  if (error) {
    throw error;
  }

  return [
    ...new Set(
      (
        data ??
        []
      )
        .map(
          row =>
            normalizeAddress(
              String(
                row.wallet_address ??
                '',
              ),
            ),
        )
        .filter(
          Boolean,
        ),
    ),
  ];
}

export async function getTrackedWalletAddressesForChain(chain: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_tracked_wallets')
    .select('wallet_address')
    .eq('chain', chain.toLowerCase());
  if (error) throw error;
  return [...new Set((data ?? []).map(row => normalizeAddress(String(row.wallet_address ?? ''))).filter(Boolean))];
}

export async function
addTrackedWallet(args: {
  telegramId: string;

  walletAddress: string;

  chain?: string;

  label?: string | null;
}): Promise<void> {
  const detected = requireWalletAddress(args.walletAddress);
  const walletAddress = detected.normalizedAddress;
  const chain = resolveTrackedWalletChain(detected.family, args.chain);
  const liveMonitoring = walletFamilyHasLiveMonitoring(chain);

  const {
    error,
  } =
    await supabase
      .from(
        'user_tracked_wallets',
      )
      .upsert(
        {
          telegram_id:
            args.telegramId,

          wallet_address:
            walletAddress,

          chain,

          label:
            args.label ??
            null,

          is_active:
            liveMonitoring,

          alerts_enabled:
            liveMonitoring,

          updated_at:
            new Date().toISOString(),
        },
        {
          onConflict:
            'telegram_id,chain,wallet_address',
        },
      );

  if (error) {
    throw error;
  }
}

export async function
setTrackedWalletActive(args: {
  telegramId: string;

  id: number;

  active: boolean;
}): Promise<void> {
  const wallet = await getTrackedWalletByIdForUser({ telegramId: args.telegramId, id: args.id });
  if (!wallet) throw new Error('Wallet not found');
  if (!walletFamilyHasLiveMonitoring(wallet.chain)) {
    throw new Error('Live monitoring is unavailable for this wallet family');
  }
  const {
    error,
  } =
    await supabase
      .from(
        'user_tracked_wallets',
      )
      .update({
        is_active:
          args.active,

        updated_at:
          new Date().toISOString(),
      })
      .eq(
        'id',
        args.id,
      )
      .eq(
        'telegram_id',
        args.telegramId,
      );

  if (error) {
    throw error;
  }
}

export async function enableRobinhoodMonitoringForSavedWallet(args: {
  telegramId: string;
  id: number;
}): Promise<TrackedWallet> {
  const source = await getTrackedWalletByIdForUser(args);
  if (!source) throw new Error('Wallet not found');
  if (source.chain !== 'evm') {
    if (source.chain === 'robinhood') {
      const { error } = await supabase
        .from('user_tracked_wallets')
        .update({ is_active: true, alerts_enabled: true, updated_at: new Date().toISOString() })
        .eq('id', source.id)
        .eq('telegram_id', args.telegramId)
        .eq('chain', 'robinhood');
      if (error) throw error;
      const enabled = await getTrackedWalletByIdForUser(args);
      if (!enabled) throw new Error('Wallet not found after enabling monitoring');
      return enabled;
    }
    throw new Error('Only a saved generic EVM wallet can enable Robinhood monitoring');
  }

  const { data: existingRows, error: existingError } = await supabase
    .from('user_tracked_wallets')
    .select('*')
    .eq('telegram_id', args.telegramId)
    .eq('chain', 'robinhood')
    .ilike('wallet_address', source.wallet_address)
    .limit(1);
  if (existingError) throw existingError;
  const existing = (existingRows?.[0] as TrackedWallet | undefined) ?? null;
  const label = existing?.label ?? source.label ?? null;
  const now = new Date().toISOString();

  let targetId = existing?.id ?? null;
  if (targetId != null) {
    const { error } = await supabase
      .from('user_tracked_wallets')
      .update({ label, is_active: true, alerts_enabled: true, updated_at: now })
      .eq('id', targetId)
      .eq('telegram_id', args.telegramId)
      .eq('chain', 'robinhood');
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from('user_tracked_wallets')
      .update({
        chain: 'robinhood',
        label,
        is_active: true,
        alerts_enabled: true,
        updated_at: now,
      })
      .eq('id', source.id)
      .eq('telegram_id', args.telegramId)
      .eq('chain', 'evm')
      .select('id')
      .single();
    if (error) throw error;
    targetId = Number(data.id);
  }

  if (targetId !== source.id) {
    const { error: cleanupError } = await supabase
      .from('user_tracked_wallets')
      .delete()
      .eq('id', source.id)
      .eq('telegram_id', args.telegramId)
      .eq('chain', 'evm');
    if (cleanupError) throw cleanupError;
  }

  const target = await getTrackedWalletByIdForUser({ telegramId: args.telegramId, id: targetId });
  if (!target) throw new Error('Robinhood wallet was not found after enabling monitoring');
  return target;
}

export async function
removeTrackedWallet(args: {
  telegramId: string;

  id: number;
}): Promise<void> {
  const wallet = await getTrackedWalletByIdForUser({ telegramId: args.telegramId, id: args.id });
  const {
    error,
  } =
    await supabase
      .from(
        'user_tracked_wallets',
      )
      .delete()
      .eq(
        'id',
        args.id,
      )
      .eq(
        'telegram_id',
        args.telegramId,
      );

  if (error) {
    throw error;
  }

  if (wallet?.chain === 'robinhood') {
    const { data: remaining, error: remainingError } = await supabase
      .from('user_tracked_wallets')
      .select('id')
      .eq('chain', 'robinhood')
      .ilike('wallet_address', wallet.wallet_address)
      .limit(1);
    if (remainingError) throw remainingError;
    if (!remaining?.length) {
      const { error: cursorError } = await supabase
        .from('wallet_monitor_cursors')
        .delete()
        .eq('chain', 'robinhood')
        .ilike('wallet_address', wallet.wallet_address);
      if (cursorError) throw cursorError;
    }
  }
}


export async function
getTrackedWalletSubscribersForAddress(args: {
  walletAddress: string;
  chain?: string;
}): Promise<TrackedWallet[]> {
  const {
    data,
    error,
  } =
    await supabase
      .from(
        'user_tracked_wallets',
      )
      .select(`
        id,
        telegram_id,
        wallet_address,
        chain,
        label,
        is_active,
        alerts_enabled,
        created_at,
        updated_at
      `)
      .ilike(
        'wallet_address',
        args.walletAddress,
      )
      .eq(
        'chain',
        String(
          args.chain ??
          'solana',
        ).toLowerCase(),
      )
      .eq(
        'is_active',
        true,
      )
      .eq(
        'alerts_enabled',
        true,
      );

  if (error) {
    throw error;
  }

  return (
    data ??
    []
  ) as TrackedWallet[];
}

export async function
getTrackedWalletByIdForUser(args: {
  telegramId: string;
  id: number;
}): Promise<TrackedWallet | null> {
  const {
    data,
    error,
  } =
    await supabase
      .from(
        'user_tracked_wallets',
      )
      .select(`
        id,
        telegram_id,
        wallet_address,
        chain,
        label,
        is_active,
        alerts_enabled,
        created_at,
        updated_at
      `)
      .eq(
        'id',
        args.id,
      )
      .eq(
        'telegram_id',
        args.telegramId,
      )
      .maybeSingle();

  if (error) {
    throw error;
  }

  return (
    data as TrackedWallet | null
  );
}

export async function
getRecentTrackedWalletActivity(
  walletAddress: string,
  limit = 10,
  telegramId?: string,
  chain = 'solana',
): Promise<Array<Record<string, any>>> {
  if (chain.toLowerCase() === 'robinhood' && telegramId) {
    const { data, error } = await supabase
      .from('wallet_activity_deliveries')
      .select('id,wallet_address,transaction_signature,activity_type,token_address,created_at,metadata')
      .eq('telegram_id', telegramId)
      .ilike('wallet_address', walletAddress)
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(25, limit)));
    if (error) throw error;
    return (data ?? []).map(row => ({
      ...row,
      action: row.activity_type,
      token: row.token_address,
      created_at: row.created_at,
    }));
  }
  const {
    data,
    error,
  } =
    await supabase
      .from(
        'wallet_trade_history',
      )
      .select('*')
      .eq(
        'wallet',
        walletAddress,
      )
      .order(
        'created_at',
        {
          ascending:
            false,
        },
      )
      .limit(
        Math.max(
          1,
          Math.min(
            25,
            limit,
          ),
        ),
      );

  if (error) {
    throw error;
  }

  return (
    data ??
    []
  ) as Array<Record<string, any>>;
}

export async function getTrackedWalletActivityById(args: { telegramId: string; walletAddress: string; id: number }) {
  const { data, error } = await supabase.from('wallet_activity_deliveries')
    .select('id,wallet_address,transaction_signature,activity_type,token_address,created_at,metadata')
    .eq('id', args.id).eq('telegram_id', args.telegramId).ilike('wallet_address', args.walletAddress).maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

export async function getRecentWalletActivityForUser(
  telegramId: string,
  limit = 15,
): Promise<Array<Record<string, any>>> {
  const wallets = await getTrackedWalletsForUser(telegramId);
  const addresses = wallets
    .filter(wallet => walletFamilyHasLiveMonitoring(wallet.chain))
    .map(wallet => wallet.wallet_address);
  if (!addresses.length) return [];

  const { data, error } = await supabase
    .from('wallet_trade_history')
    .select('*')
    .in('wallet', addresses)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(50, limit)));
  if (error) throw error;
  const { data: deliveries, error: deliveryError } = await supabase
    .from('wallet_activity_deliveries')
    .select('activity_type,token_address,created_at')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(50, limit)));
  if (deliveryError) throw deliveryError;
  return [
    ...(data ?? []),
    ...(deliveries ?? [])
      .filter(row => /^0x[a-fA-F0-9]{40}$/.test(String(row.token_address ?? '')))
      .map(row => ({ action: row.activity_type, token: row.token_address, created_at: row.created_at })),
  ].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))).slice(0, limit);
}
