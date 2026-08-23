import {
  Markup,
  type Telegraf,
} from 'telegraf';

import {
  PublicKey,
} from '@solana/web3.js';

import {
  addTrackedWallet,
  getRecentTrackedWalletActivity,
  getTrackedWalletByIdForUser,
  getTrackedWalletsForUser,
  removeTrackedWallet,
  setTrackedWalletActive,
} from '../services/trackedWalletService.js';

const pendingWalletAdds =
  new Set<string>();

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
    '🐋 <b>WALLET TRACKING</b>',
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
        ? `<b>${wallet.label}</b> · `
        : ''
      }<code>${shortAddress(
        wallet.wallet_address,
      )}</code>`,
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
      '⬅️ Main Menu',
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
  } catch {
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
  bot.action(
    'WALLET_TRACKING',
    async ctx => {
      await ctx.answerCbQuery();

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

      pendingWalletAdds.add(
        telegramId,
      );

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
        pendingWalletAdds.delete(
          telegramId,
        );
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

        await addTrackedWallet({
          telegramId,

          walletAddress,

          chain:
            'solana',

          label,
        });

        await ctx.reply(
          [
            '✅ <b>Wallet Added</b>',
            '',
            label
              ? `<b>${label}</b>`
              : 'Wallet',

            `<code>${walletAddress}</code>`,
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
            ? `<b>${wallet.label}</b>`
            : 'Tracked wallet',
          `<code>${wallet.wallet_address}</code>`,
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
            ? `<b>${wallet.label}</b>`
            : `<code>${shortAddress(
                wallet.wallet_address,
              )}</code>`,
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
            `${icon} <b>${action ||
              'ACTIVITY'}</b> ${token}${amountText}`,
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
        !pendingWalletAdds.has(
          telegramId,
        )
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
          pendingWalletAdds.delete(
            telegramId,
          );

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
          new PublicKey(
            value,
          ).toBase58();

        await addTrackedWallet({
          telegramId,

          walletAddress:
            address,

          chain:
            'solana',
        });

        pendingWalletAdds.delete(
          telegramId,
        );

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
