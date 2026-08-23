import {
  sendTelegram,
} from './telegram.js';

import {
  config,
} from '../config.js';

import {
  supabase,
} from './supabase.js';

import {
  resolveTokenOpenTarget,
} from '../core/tokenOpenRouter.js';

import {
  getTrackedWalletSubscribersForAddress,
} from './trackedWalletService.js';

import type {
  WalletWatchEvent,
} from '../core/walletWatcher.js';
import { escapeTelegramHtml } from '../ui/escapeHtml.js';
import { getUserByTelegramId } from '../core/subscriptions.js';
import { accessProfileForUser, hasCapability } from '../product/capabilities.js';
import { assertAlphaActions, renderAlphaNotification, type AlphaNotificationState } from '../ui/alphaNotification.js';
import { deliverReservedTelegram } from './telegramDeliveryContract.js';
import { createLeaseToken, DELIVERY_LEASE_SECONDS } from './reservationLease.js';

type InlineButton = {
  text: string;

  url?: string;

  callback_data?: string;
};

function shortAddress(
  value: string,
): string {
  if (
    value.length <=
    14
  ) {
    return value;
  }

  return (
    value.slice(
      0,
      6,
    ) +
    '…' +
    value.slice(
      -6,
    )
  );
}

function formatAmount(
  value: number | null,
): string {
  if (
    value == null ||
    !Number.isFinite(
      value,
    )
  ) {
    return '-';
  }

  if (
    value >=
    1
  ) {
    return `${value.toFixed(
      2,
    )} SOL`;
  }

  return `${value.toFixed(
    4,
  )} SOL`;
}

function activityTitle(
  event: WalletWatchEvent,
): string {
  switch (
    event.kind
  ) {
    case 'buy':
      return '🐋 WALLET BUY';

    case 'sell':
      return '🔴 WALLET SELL';

    case 'launch':
      return '🚀 WALLET LAUNCH';
  }
}

function actionLabel(
  event: WalletWatchEvent,
): string {
  switch (
    event.kind
  ) {
    case 'buy':
      return 'bought';

    case 'sell':
      return 'sold';

    case 'launch':
      return 'launched';
  }
}

async function reserveDelivery(args: {
  telegramId: string;

  event: WalletWatchEvent;
}): Promise<string | null> {
  const leaseToken = createLeaseToken();
  const { data, error } = await supabase.rpc('reserve_wallet_activity_delivery', {
    p_telegram_id: args.telegramId,
    p_wallet_address: args.event.wallet,
    p_transaction_signature: args.event.signature,
    p_activity_type: args.event.kind.toUpperCase(),
    p_token_address: args.event.tokenMint ?? null,
    p_lease_token: leaseToken,
    p_lease_seconds: DELIVERY_LEASE_SECONDS,
  });
  if (error) throw error;
  return data === true ? leaseToken : null;
}

async function markDelivered(args: {
  telegramId: string;

  event: WalletWatchEvent;
  leaseToken: string;
}) {
  const { data, error } = await supabase
    .from(
      'wallet_activity_deliveries',
    )
    .update({
      delivered_at:
        new Date().toISOString(),

      metadata: {
        state:
          'DELIVERED',
      },
    })
    .eq(
      'telegram_id',
      args.telegramId,
    )
    .eq(
      'wallet_address',
      args.event.wallet,
    )
    .eq(
      'transaction_signature',
      args.event.signature,
    )
    .contains('metadata', { state: 'RESERVED', lease_token: args.leaseToken })
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Wallet delivery lease was lost before completion');
}

async function releaseDelivery(args: {
  telegramId: string;

  event: WalletWatchEvent;
  leaseToken: string;
}) {
  const { error } = await supabase
    .from(
      'wallet_activity_deliveries',
    )
    .delete()
    .eq(
      'telegram_id',
      args.telegramId,
    )
    .eq(
      'wallet_address',
      args.event.wallet,
    )
    .eq(
      'transaction_signature',
      args.event.signature,
    )
    .contains('metadata', { state: 'RESERVED', lease_token: args.leaseToken });
  if (error) throw error;
}

async function buildButtons(
  event: WalletWatchEvent,
): Promise<InlineButton[][]> {
  const buttons:
    InlineButton[][] = [];

  if (
    event.tokenMint
  ) {
    const target =
      await resolveTokenOpenTarget({
        chain:
          'solana',

        tokenAddress:
          event.tokenMint,
      });

    const marketActions: InlineButton[] = [];
    if (target.chartUrl && target.chartUrl !== target.tokenUrl) {
      marketActions.push({ text: '📊 Chart', url: target.chartUrl });
    }
    marketActions.push({ text: '🔎 Token', url: target.tokenUrl });
    buttons.push(marketActions);
    buttons.push([{
      text: '🐋 Wallet Activity',
      callback_data: 'WALLET_TRACKING',
    }]);
  } else {
    buttons.push([
      {
        text:
          '🐋 Wallet Activity',

        callback_data:
          'WALLET_TRACKING',
      },
    ]);
  }

  return assertAlphaActions(buttons);
}

export function buildWalletActivityMessage(args: {
  event: WalletWatchEvent;

  label: string | null;
}): string {
  const {
    event,
  } =
    args;

  const wallet =
    args.label?.trim() ||
    shortAddress(
      event.wallet,
    );

  const state: AlphaNotificationState = event.kind === 'buy'
    ? 'WALLET_BUY'
    : event.kind === 'sell'
      ? 'WALLET_SELL'
      : 'WALLET_LAUNCH';
  return renderAlphaNotification({
    category: 'wallet',
    severity: event.kind === 'sell' ? 'warning' : event.kind === 'buy' ? 'positive' : 'watch',
    state,
    symbol: wallet,
    subtitle: event.tokenMint ? shortAddress(event.tokenMint) : undefined,
    address: event.wallet,
    metrics: event.kind === 'launch' ? [] : [{ label: 'Value', value: formatAmount(event.amountSol) }],
    reason: event.kind === 'buy'
      ? 'Watched wallet opened a position.'
      : event.kind === 'sell'
        ? 'Watched wallet reduced a position.'
        : 'Watched wallet interacted with a new launch.',
    recommendedAction: 'Review current market conditions before acting.',
  });
}

export async function
deliverTrackedWalletActivity(
  events: WalletWatchEvent[],
): Promise<void> {
  for (
    const event
    of events
  ) {
    try {
      const subscribers =
        await getTrackedWalletSubscribersForAddress({
          walletAddress:
            event.wallet,

          chain:
            'solana',
        });

      /*
       * Compatibility bridge:
       *
       * Older admin watched wallets may still live in
       * WATCHED_WALLETS rather than user_tracked_wallets.
       *
       * Unified WalletActivity owns delivery for BOTH sources.
       * This preserves admin coverage while eliminating the old
       * second Telegram broadcaster.
       */
      const legacyAdminWatch =
        (
          config.watchedWallets ??
          []
        ).some(
          wallet =>
            String(
              wallet,
            ).toLowerCase() ===
            String(
              event.wallet,
            ).toLowerCase(),
        );

      if (
        legacyAdminWatch &&
        config.adminTelegramId &&
        !subscribers.some(
          subscriber =>
            subscriber.telegram_id ===
            config.adminTelegramId,
        )
      ) {
        subscribers.push({
          id:
            -1,

          telegram_id:
            config.adminTelegramId,

          wallet_address:
            event.wallet,

          chain:
            'solana',

          label:
            'Smart Wallet',

          is_active:
            true,

          alerts_enabled:
            true,

          created_at:
            new Date().toISOString(),

          updated_at:
            new Date().toISOString(),
        });
      }

      if (
        subscribers.length ===
        0
      ) {
        continue;
      }

      const buttons =
        await buildButtons(
          event,
        );

      for (
        const subscriber
        of subscribers
      ) {
        const user = await getUserByTelegramId(subscriber.telegram_id);
        if (!hasCapability(accessProfileForUser(user), 'wallets.activity')) {
          continue;
        }

        const leaseToken =
          await reserveDelivery({
            telegramId:
              subscriber.telegram_id,

            event,
          });

        if (!leaseToken) {
          continue;
        }

        const delivery = await deliverReservedTelegram({
          send: () => sendTelegram(
            subscriber.telegram_id,

            buildWalletActivityMessage({
              event,

              label:
                subscriber.label,
            }),

            buttons,
          ),
          complete: () => markDelivered({
            telegramId:
              subscriber.telegram_id,

            event,
            leaseToken,
          }),
          release: () => releaseDelivery({ telegramId: subscriber.telegram_id, event, leaseToken }),
        });

        if (delivery.recorded) {
          console.log(
            '[WalletActivity] Delivered:',
            {
              telegramId:
                subscriber.telegram_id,

              wallet:
                event.wallet,

              kind:
                event.kind,

              token:
                event.tokenMint,
            },
          );
        } else if (delivery.error) {
          const error = delivery.error;
          console.error(
            delivery.sent
              ? '[WalletActivity] Delivery accounting failed after Telegram send:'
              : '[WalletActivity] Delivery failed:',
            {
              telegramId:
                subscriber.telegram_id,

              wallet:
                event.wallet,

              error:
                error instanceof Error
                  ? error.message
                  : String(
                      error,
                    ),
            },
          );
        }
      }
    } catch (
      error
    ) {
      console.error(
        '[WalletActivity] Event processing failed:',
        {
          wallet:
            event.wallet,

          signature:
            event.signature,

          error:
            error instanceof Error
              ? error.message
              : String(
                  error,
                ),
        },
      );
    }
  }
}
