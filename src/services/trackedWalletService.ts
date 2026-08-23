import {
  supabase,
} from './supabase.js';

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

export async function
addTrackedWallet(args: {
  telegramId: string;

  walletAddress: string;

  chain?: string;

  label?: string | null;
}): Promise<void> {
  const walletAddress =
    normalizeAddress(
      args.walletAddress,
    );

  if (!walletAddress) {
    throw new Error(
      'Wallet address is required',
    );
  }

  const chain =
    String(
      args.chain ??
      'solana',
    )
      .trim()
      .toLowerCase();

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
            true,

          alerts_enabled:
            true,

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

export async function
removeTrackedWallet(args: {
  telegramId: string;

  id: number;
}): Promise<void> {
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
}
