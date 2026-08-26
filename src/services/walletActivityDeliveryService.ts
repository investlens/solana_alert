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
import { buildAlphaMarketActions } from '../ui/alphaNotificationActions.js';
import { deliverReservedTelegram } from './telegramDeliveryContract.js';
import { createLeaseToken, DELIVERY_LEASE_SECONDS } from './reservationLease.js';
import { coreDecisionEvidenceMetrics, marketContextMetrics, normalizeCoreDecisionMetrics, normalizeNotificationMarketContext } from '../ui/notificationMarketContext.js';
import { walletActivityMetadata } from './walletActivityPresentation.js';

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
    case 'receive':
      return '🐋 TOKEN RECEIVED';
    case 'send':
      return '🐋 TOKEN SENT';
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
    case 'receive':
      return 'received';
    case 'send':
      return 'sent';
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
        ...walletActivityMetadata(args.event),
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
  target?: Awaited<ReturnType<typeof resolveTokenOpenTarget>>,
): Promise<InlineButton[][]> {
  if (
    event.tokenMint
  ) {
    const resolved = target ??
      await resolveTokenOpenTarget({
        chain: event.chain ?? 'solana',

        tokenAddress:
          event.tokenMint,
      });

    return buildWalletActivityButtons(event, resolved);
  }
  return assertAlphaActions([[{ text: '🐋 Wallet Activity', callback_data: 'WALLET_TRACKING' }]]);
}

export function buildWalletActivityButtons(
  event: WalletWatchEvent,
  target: Awaited<ReturnType<typeof resolveTokenOpenTarget>>,
): InlineButton[][] {
  return buildAlphaMarketActions({
    chartUrl: target.chartUrl,
    tokenUrl: target.tokenUrl,
    copyContractCallback: event.chain === 'robinhood' && event.tokenMint ? `COPY_CA_${event.tokenMint}` : null,
    walletActivityCallback: 'WALLET_TRACKING',
  });
}

async function enrichWalletEvent(event: WalletWatchEvent) {
  if (!event.tokenMint) return undefined;
  const current = event as unknown as Record<string, any>;
  const target = await resolveTokenOpenTarget({
    chain: event.chain ?? 'solana',
    tokenAddress: event.tokenMint,
  });
  let opportunityRaw: Record<string, unknown> | null = null;
  if (event.chain === 'robinhood') {
    const { data, error } = await supabase
      .from('opportunities')
      .select('raw_data')
      .ilike('asset_id', event.tokenMint)
      .eq('chain', 'robinhood')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    opportunityRaw = (data?.raw_data as Record<string, unknown> | null) ?? null;
  }
  const market = normalizeNotificationMarketContext(
    current,
    target.marketContext as Record<string, unknown> | undefined,
    opportunityRaw,
    { marketIndexState: target.marketIndexState },
    { address: event.tokenMint },
  );
  Object.assign(event, {
    tokenSymbol: market.symbol ?? event.tokenSymbol,
    tokenName: market.name ?? event.tokenName,
    marketCap: market.marketCap ?? current.marketCap,
    fdv: market.fdv ?? current.fdv,
    preIndexValuation: opportunityRaw?.preIndexValuation ?? current.preIndexValuation,
    liquidity: market.liquidity ?? current.liquidity,
    volume5m: market.volume5m ?? current.volume5m,
    chartUrl: target.chartUrl ?? current.chartUrl,
    devHoldingPercent: opportunityRaw?.devHoldingPercent ?? current.devHoldingPercent,
    devHoldingEvidence: opportunityRaw?.devHoldingEvidence ?? current.devHoldingEvidence,
    burnedPercent: opportunityRaw?.totalBurnPercent ?? opportunityRaw?.burnedPercent ?? current.burnedPercent,
    burnEvidence: opportunityRaw?.burnEvidence ?? current.burnEvidence,
  });
  return target;
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
      : event.kind === 'launch'
        ? 'WALLET_LAUNCH'
        : 'WALLET_MOVE';
  const market = normalizeNotificationMarketContext(event as unknown as Record<string, unknown>);
  const decisionEvidence = normalizeCoreDecisionMetrics(event as unknown as Record<string, unknown>);
  const tokenAmount = 'tokenAmount' in event ? event.tokenAmount : null;
  const amountSol = 'amountSol' in event ? event.amountSol : null;
  const amount = tokenAmount == null
    ? null
    : `${tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${event.tokenSymbol ?? 'tokens'}`;
  const amountLabel = event.kind === 'sell'
    ? 'Sold'
    : event.kind === 'send'
      ? 'Sent'
      : 'Amount';
  return renderAlphaNotification({
    category: 'wallet',
    severity: event.kind === 'sell' ? 'warning' : event.kind === 'buy' ? 'positive' : 'watch',
    state,
    symbol: event.tokenSymbol,
    token: event.tokenName,
    subtitle: event.tokenName,
    address: event.tokenMint,
    metrics: [
      { label: 'Wallet', value: wallet.toUpperCase() },
      ...(amount ? [{ label: amountLabel, value: amount }] : []),
      ...marketContextMetrics(market),
      ...(amountSol == null ? [] : [{ label: 'Value', value: formatAmount(amountSol) }]),
    ],
    specialistMetrics: coreDecisionEvidenceMetrics(decisionEvidence),
    reason: event.kind === 'buy'
      ? 'Watched wallet opened a position.'
      : event.kind === 'sell'
        ? 'Watched wallet reduced a position.'
        : event.kind === 'launch'
          ? 'Watched wallet created a verified PONS launch.'
          : event.kind === 'receive'
            ? 'Watched wallet received tokens; a purchase was not proven.'
            : 'Watched wallet sent tokens; a sale was not proven.',
    recommendedAction: 'Review current market conditions before acting.',
  });
}

export async function
deliverTrackedWalletActivity(
  events: WalletWatchEvent[],
): Promise<{ failedWallets: Set<string> }> {
  const failedWallets = new Set<string>();
  for (
    const event
    of events
  ) {
    try {
      const subscribers =
        await getTrackedWalletSubscribersForAddress({
          walletAddress:
            event.wallet,

          chain: event.chain ?? 'solana',
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
      const legacyAdminWatch = event.chain !== 'robinhood' &&
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

      const target = await enrichWalletEvent(event);

      const buttons =
        await buildButtons(
          event,
          target,
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
          const { data: existing, error: existingError } = await supabase
            .from('wallet_activity_deliveries')
            .select('metadata,delivered_at')
            .eq('telegram_id', subscriber.telegram_id)
            .ilike('wallet_address', event.wallet)
            .eq('transaction_signature', event.signature)
            .maybeSingle();
          if (existingError) throw existingError;
          const state = (existing?.metadata as Record<string, unknown> | null)?.state;
          // A completed idempotency hit is safe. A live/lost reservation must hold the range for retry.
          if (state !== 'DELIVERED' || !existing?.delivered_at) failedWallets.add(event.wallet.toLowerCase());
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
          failedWallets.add(event.wallet.toLowerCase());
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
      failedWallets.add(event.wallet.toLowerCase());
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
  return { failedWallets };
}
