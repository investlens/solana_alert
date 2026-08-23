import {
  sendTelegram,
} from './telegram.js';

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
}): Promise<boolean> {
  const {
    error,
  } =
    await supabase
      .from(
        'wallet_activity_deliveries',
      )
      .insert({
        telegram_id:
          args.telegramId,

        wallet_address:
          args.event.wallet,

        transaction_signature:
          args.event.signature,

        activity_type:
          args.event.kind.toUpperCase(),

        token_address:
          args.event.tokenMint ??
          null,

        metadata: {
          state:
            'RESERVED',
        },
      });

  if (!error) {
    return true;
  }

  if (
    error.code ===
    '23505'
  ) {
    return false;
  }

  throw error;
}

async function markDelivered(args: {
  telegramId: string;

  event: WalletWatchEvent;
}) {
  await supabase
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
    );
}

async function releaseDelivery(args: {
  telegramId: string;

  event: WalletWatchEvent;
}) {
  await supabase
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
    );
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

    buttons.push([
      {
        text:
          target.source ===
          'dexscreener'
            ? '📊 CHART'
            : '🔎 TOKEN',

        url:
          target.url,
      },

      {
        text:
          '🐋 ACTIVITY',

        callback_data:
          'WALLET_TRACKING',
      },
    ]);
  } else {
    buttons.push([
      {
        text:
          '🐋 WALLET ACTIVITY',

        callback_data:
          'WALLET_TRACKING',
      },
    ]);
  }

  return buttons;
}

function buildMessage(args: {
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

  const lines = [
    `<b>${activityTitle(
      event,
    )}</b>`,
    '',
    `<b>${wallet}</b> ${actionLabel(
      event,
    )}`,
  ];

  if (
    event.tokenMint
  ) {
    lines.push(
      `<code>${shortAddress(
        event.tokenMint,
      )}</code>`,
    );
  }

  if (
    (
      event.kind ===
      'buy' ||
      event.kind ===
      'sell'
    )
  ) {
    lines.push(
      '',
      `Value   <b>${formatAmount(
        event.amountSol,
      )}</b>`,
    );
  }

  lines.push(
    '',
    '<i>Tracked-wallet activity · verify market conditions before acting.</i>',
  );

  return lines.join(
    '\n',
  );
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
        const reserved =
          await reserveDelivery({
            telegramId:
              subscriber.telegram_id,

            event,
          });

        if (!reserved) {
          continue;
        }

        try {
          await sendTelegram(
            subscriber.telegram_id,

            buildMessage({
              event,

              label:
                subscriber.label,
            }),

            buttons,
          );

          await markDelivered({
            telegramId:
              subscriber.telegram_id,

            event,
          });

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
        } catch (
          error
        ) {
          await releaseDelivery({
            telegramId:
              subscriber.telegram_id,

            event,
          });

          console.error(
            '[WalletActivity] Delivery failed:',
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
