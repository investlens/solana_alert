import {
  Markup,
  type Telegraf,
} from 'telegraf';

import {
  addTrackedWallet,
  getRecentTrackedWalletActivity,
  getRecentWalletActivityForUser,
  getTrackedWalletByIdForUser,
  getTrackedWalletsForUser,
  removeTrackedWallet,
  setTrackedWalletActive,
} from '../services/trackedWalletService.js';
import {
  clearConversationState,
  getConversationState,
  setConversationState,
} from './conversationState.js';
import {
  escapeTelegramHtml,
  normalizeSolanaPublicAddress,
} from './walletInput.js';
import { getContextAccess, requireCapability } from './accessControl.js';
import { hasCapability } from '../product/capabilities.js';

function userId(
  ctx: any,
): string | null {
  const id =
    ctx.from?.id;

  return id == null
    ? null
    : String(id);
}

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

function isMessageNotModified(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : String(error);
  return message.toLowerCase().includes('message is not modified');
}

async function renderWalletCenter(
  ctx: any,
) {
  const telegramId =
    userId(
      ctx,
    );

  if (!telegramId) {
    return;
  }

  const wallets =
    await getTrackedWalletsForUser(
      telegramId,
    );

  const lines = [
    '🐋 <b>WALLETS</b>',
    '',
    wallets.length ===
    0
      ? 'No wallets tracked yet.'
      : `Tracked wallets: <b>${wallets.length}</b>`,
    '',
  ];

  for (
    const wallet
    of wallets.slice(
      0,
      10,
    )
  ) {
    lines.push(
      `${
        wallet.is_active
          ? '🟢'
          : '⚪'
      } ${wallet.label
        ? `<b>${escapeTelegramHtml(wallet.label)}</b> · `
        : ''
      }<code>${escapeTelegramHtml(shortAddress(
        wallet.wallet_address,
      ))}</code>`,
    );
  }

  lines.push(
    '',
    '<i>Public wallet addresses only. Never share private keys or seed phrases.</i>',
  );

  const buttons:
    any[][] = [
      [
        Markup.button.callback(
          '➕ Add Wallet',
          'WALLET_ADD_HELP',
        ),

        Markup.button.callback(
          '🔄 Refresh',
          'WALLET_TRACKING',
        ),
      ],
      [Markup.button.callback('⚡ Recent Activity', 'WALLET_RECENT_ACTIVITY')],
    ];

  for (
    const wallet
    of wallets.slice(
      0,
      8,
    )
  ) {
    buttons.push([
      Markup.button.callback(
        wallet.is_active
          ? `⏸ ${shortAddress(
              wallet.wallet_address,
            )}`
          : `▶️ ${shortAddress(
              wallet.wallet_address,
            )}`,

        `WALLET_TOGGLE_${wallet.id}`,
      ),

      Markup.button.callback(
        '⚡ Activity',
        `WALLET_ACTIVITY_${wallet.id}`,
      ),

      Markup.button.callback(
        '🗑',
        `WALLET_REMOVE_CONFIRM_${wallet.id}`,
      ),
    ]);
  }

  buttons.push([
    Markup.button.callback(
      '🏠 Home',
      'MAIN_MENU',
    ),
  ]);

  const options = {
    parse_mode:
      'HTML' as const,

    reply_markup:
      Markup.inlineKeyboard(
        buttons,
      ).reply_markup,
  };

  try {
    await ctx.editMessageText(
      lines.join(
        '\n',
      ),
      options,
    );
  } catch (error) {
    if (isMessageNotModified(error)) return;
    await ctx.reply(
      lines.join(
        '\n',
      ),
      options,
    );
  }
}

export function
registerWalletTracking(
  bot: Telegraf<any>,
) {
  bot.use(async (ctx, next) => {
    const telegramId = userId(ctx);
    const callback = String((ctx.callbackQuery as any)?.data ?? '');
    const command = String((ctx.message as any)?.text ?? '').split(/\s+/, 1)[0].toLowerCase();
    const walletFlow = Boolean(
      callback.startsWith('WALLET_') ||
      command === '/trackwallet' ||
      (telegramId && getConversationState(telegramId) === 'ADD_WALLET')
    );

    if (!walletFlow) return next();

    const access = await getContextAccess(ctx);
    if (hasCapability(access, 'wallets.track')) return next();

    if (telegramId) clearConversationState(telegramId);
    await requireCapability(ctx, 'wallets.track', 'SETTINGS');
  });

  bot.action(
    'WALLET_TRACKING',
    async ctx => {
      await ctx.answerCbQuery();

      const telegramId = userId(ctx);
      if (telegramId) clearConversationState(telegramId);

      await renderWalletCenter(
        ctx,
      );
    },
  );

  bot.action(
    'WALLET_ADD_HELP',
    async ctx => {
      const telegramId =
        userId(
          ctx,
        );

      if (!telegramId) {
        return;
      }

      setConversationState(telegramId, 'ADD_WALLET');

      await ctx.answerCbQuery(
        'Paste wallet address',
      );

      await ctx.reply(
        [
          '➕ <b>ADD WALLET</b>',
          '',
          'Paste the public Solana wallet address below.',
          '',
          '<i>No private key or seed phrase is ever required.</i>',
        ].join(
          '\n',
        ),
        {
          parse_mode:
            'HTML',

          reply_markup:
            Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  '✖️ Cancel',
                  'WALLET_ADD_CANCEL',
                ),

                Markup.button.callback(
                  '⬅️ Wallets',
                  'WALLET_TRACKING',
                ),
                Markup.button.callback(
                  '🏠 Home',
                  'MAIN_MENU',
                ),
              ],
            ]).reply_markup,
        },
      );
    },
  );

  bot.action(
    'WALLET_ADD_CANCEL',
    async ctx => {
      const telegramId =
        userId(
          ctx,
        );

      if (telegramId) {
        clearConversationState(telegramId);
      }

      await ctx.answerCbQuery(
        'Cancelled',
      );

      await renderWalletCenter(
        ctx,
      );
    },
  );

  bot.command(
    'trackwallet',
    async ctx => {
      try {
        const telegramId =
          userId(
            ctx,
          );

        if (!telegramId) {
          return;
        }

        const message =
          String(
            ctx.message?.text ??
            '',
          );

        const parts =
          message
            .trim()
            .split(
              /\s+/,
            );

        const walletAddress =
          parts[1];

        const label =
          parts
            .slice(
              2,
            )
            .join(
              ' ',
            )
            .trim() ||
          null;

        if (!walletAddress) {
          await ctx.reply(
            'Usage: /trackwallet WALLET_ADDRESS optional label',
          );

          return;
        }

        let address: string;
        try {
          address = normalizeSolanaPublicAddress(walletAddress);
        } catch {
          await ctx.reply('❌ That does not look like a valid Solana wallet.');
          return;
        }

        await addTrackedWallet({
          telegramId,

          walletAddress: address,

          chain:
            'solana',

          label,
        });

        await ctx.reply(
          [
            '✅ <b>Wallet Added</b>',
            '',
            label
              ? `<b>${escapeTelegramHtml(label)}</b>`
              : 'Wallet',

            `<code>${escapeTelegramHtml(address)}</code>`,
            '',
            'AlphaOS will include this wallet in activity tracking.',
          ].join(
            '\n',
          ),
          {
            parse_mode:
              'HTML',

            reply_markup:
              Markup.inlineKeyboard([
                [
                  Markup.button.callback(
                    '🐋 View Wallets',
                    'WALLET_TRACKING',
                  ),
                ],
              ]).reply_markup,
          },
        );
      } catch (
        error
      ) {
        console.error(
          '[WalletTracking] Add wallet failed:',
          error,
        );

        await ctx.reply(
          'Could not add that wallet.',
        );
      }
    },
  );

  bot.action(
    'WALLET_RECENT_ACTIVITY',
    async ctx => {
      const telegramId = userId(ctx);
      if (!telegramId) return;
      await ctx.answerCbQuery();
      try {
        const activity = await getRecentWalletActivityForUser(telegramId, 12);
        const lines = ['⚡ <b>RECENT WALLET ACTIVITY</b>', ''];
        if (!activity.length) lines.push('No tracked-wallet activity recorded yet.');
        for (const row of activity) {
          lines.push(
            `${String(row.action ?? '').toUpperCase() === 'SELL' ? '🔴' : '🟢'} ` +
            `<b>${escapeTelegramHtml(String(row.action ?? 'Activity').toUpperCase())}</b> ` +
            `${escapeTelegramHtml(shortAddress(String(row.token ?? '-')))}`,
          );
        }
        await ctx.reply(lines.join('\n'), {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([[
            Markup.button.callback('⬅️ Wallets', 'WALLET_TRACKING'),
            Markup.button.callback('🏠 Home', 'MAIN_MENU'),
          ]]).reply_markup,
        });
      } catch (error) {
        console.error('[WalletTracking] Recent activity failed:', error);
        await ctx.reply('Unable to load recent wallet activity. Please try again.');
      }
    },
  );

  bot.action(
    /^WALLET_TOGGLE_(\d+)$/,
    async ctx => {
      try {
        const telegramId =
          userId(
            ctx,
          );

        if (!telegramId) {
          return;
        }

        const id =
          Number(
            ctx.match[1],
          );

        const wallets =
          await getTrackedWalletsForUser(
            telegramId,
          );

        const wallet =
          wallets.find(
            row =>
              row.id ===
              id,
          );

        if (!wallet) {
          await ctx.answerCbQuery(
            'Wallet not found',
          );

          return;
        }

        await setTrackedWalletActive({
          telegramId,

          id,

          active:
            !wallet.is_active,
        });

        await ctx.answerCbQuery(
          wallet.is_active
            ? 'Tracking paused'
            : 'Tracking enabled',
        );

        await renderWalletCenter(
          ctx,
        );
      } catch (
        error
      ) {
        console.error(
          '[WalletTracking] Toggle failed:',
          error,
        );

        await ctx.answerCbQuery('Could not update wallet', {
          show_alert: true,
        }).catch(() => {});
      }
    },
  );

  bot.action(
    /^WALLET_REMOVE_CONFIRM_(\d+)$/,
    async ctx => {
      const telegramId =
        userId(
          ctx,
        );

      if (!telegramId) {
        return;
      }

      const wallet =
        await getTrackedWalletByIdForUser({
          telegramId,

          id:
            Number(
              ctx.match[1],
            ),
        });

      if (!wallet) {
        await ctx.answerCbQuery(
          'Wallet not found',
        );

        return;
      }

      await ctx.answerCbQuery();

      await ctx.reply(
        [
          '🗑 <b>REMOVE WALLET?</b>',
          '',
          wallet.label
            ? `<b>${escapeTelegramHtml(wallet.label)}</b>`
            : 'Tracked wallet',
          `<code>${escapeTelegramHtml(wallet.wallet_address)}</code>`,
          '',
          'This stops AlphaOS wallet activity tracking for this address.',
        ].join(
          '\n',
        ),
        {
          parse_mode:
            'HTML',

          reply_markup:
            Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  '🗑 Yes, Remove',
                  `WALLET_REMOVE_${wallet.id}`,
                ),
              ],
              [
                Markup.button.callback(
                  '⬅️ Keep Wallet',
                  'WALLET_TRACKING',
                ),
              ],
            ]).reply_markup,
        },
      );
    },
  );

  bot.action(
    /^WALLET_REMOVE_(\d+)$/,
    async ctx => {
      try {
        const telegramId =
          userId(
            ctx,
          );

        if (!telegramId) {
          return;
        }

        await removeTrackedWallet({
          telegramId,

          id:
            Number(
              ctx.match[1],
            ),
        });

        await ctx.answerCbQuery(
          'Wallet removed',
        );

        await renderWalletCenter(
          ctx,
        );
      } catch (
        error
      ) {
        console.error(
          '[WalletTracking] Remove failed:',
          error,
        );

        await ctx.answerCbQuery('Could not remove wallet', {
          show_alert: true,
        }).catch(() => {});
      }
    },
  );


  bot.action(
    /^WALLET_ACTIVITY_(\d+)$/,
    async ctx => {
      try {
        const telegramId =
          userId(
            ctx,
          );

        if (!telegramId) {
          return;
        }

        const wallet =
          await getTrackedWalletByIdForUser({
            telegramId,

            id:
              Number(
                ctx.match[1],
              ),
          });

        if (!wallet) {
          await ctx.answerCbQuery(
            'Wallet not found',
          );

          return;
        }

        const activity =
          await getRecentTrackedWalletActivity(
            wallet.wallet_address,
            8,
          );

        const lines = [
          '⚡ <b>WALLET ACTIVITY</b>',
          '',
          wallet.label
            ? `<b>${escapeTelegramHtml(wallet.label)}</b>`
            : `<code>${escapeTelegramHtml(shortAddress(
                wallet.wallet_address,
              ))}</code>`,
          '',
        ];

        if (
          activity.length ===
          0
        ) {
          lines.push(
            'No recorded buy/sell activity yet.',
          );
        }

        for (
          const row
          of activity
        ) {
          const action =
            String(
              row.action ??
              '',
            ).toUpperCase();

          const icon =
            action ===
            'BUY'
              ? '🟢'
              : action ===
                'SELL'
                ? '🔴'
                : '⚪';

          const token =
            shortAddress(
              String(
                row.token ??
                '-',
              ),
            );

          const amount =
            Number(
              row.amount_sol,
            );

          const amountText =
            Number.isFinite(
              amount,
            ) &&
            amount >
            0
              ? ` · ${amount.toFixed(
                  3,
                )} SOL`
              : '';

          lines.push(
            `${icon} <b>${escapeTelegramHtml(action ||
              'ACTIVITY')}</b> ${escapeTelegramHtml(token)}${amountText}`,
          );
        }

        await ctx.answerCbQuery();

        await ctx.reply(
          lines.join(
            '\n',
          ),
          {
            parse_mode:
              'HTML',

            reply_markup:
              Markup.inlineKeyboard([
                [
                  Markup.button.callback(
                    '⬅️ Wallets',
                    'WALLET_TRACKING',
                  ),

                  Markup.button.callback(
                    '🔄 Refresh',
                    `WALLET_ACTIVITY_${wallet.id}`,
                  ),
                ],
                [Markup.button.callback('🏠 Home', 'MAIN_MENU')],
              ]).reply_markup,
          },
        );
      } catch (
        error
      ) {
        console.error(
          '[WalletTracking] Activity failed:',
          error,
        );

        await ctx.answerCbQuery('Could not load wallet activity', {
          show_alert: true,
        }).catch(() => {});
      }
    },
  );

  bot.on(
    'text',
    async (
      ctx,
      next,
    ) => {
      const telegramId =
        userId(
          ctx,
        );

      if (
        !telegramId ||
        getConversationState(telegramId) !== 'ADD_WALLET'
      ) {
        return next();
      }

      const value =
        String(
          ctx.message?.text ??
          '',
        ).trim();

      if (
        value.startsWith(
          '/',
        )
      ) {
        if (
          value.toLowerCase() ===
          '/cancel'
        ) {
          clearConversationState(telegramId);

          await ctx.reply(
            'Wallet add cancelled.',
          );

          return;
        }

        return next();
      }

      try {
        /*
         * Constructor validation prevents random text from
         * becoming a tracked Solana wallet.
         */
        const address =
          normalizeSolanaPublicAddress(value);

        await addTrackedWallet({
          telegramId,

          walletAddress:
            address,

          chain:
            'solana',
        });

        clearConversationState(telegramId);

        await ctx.reply(
          [
            '✅ <b>WALLET TRACKING ACTIVE</b>',
            '',
            `<code>${address}</code>`,
            '',
            'AlphaOS will alert you when this wallet buys or sells.',
          ].join(
            '\n',
          ),
          {
            parse_mode:
              'HTML',

            reply_markup:
              Markup.inlineKeyboard([
                [
                  Markup.button.callback(
                    '🐋 View Wallets',
                    'WALLET_TRACKING',
                  ),
                ],
              ]).reply_markup,
          },
        );
      } catch {
        await ctx.reply(
          [
            '❌ That does not look like a valid Solana wallet.',
            '',
            'Paste the public wallet address again or send /cancel.',
          ].join(
            '\n',
          ),
        );
      }
    },
  );

  console.log(
    '[WalletTracking] Registered.',
  );
}
