import {
  Markup,
  type Telegraf,
} from 'telegraf';

import {
  addTrackedWallet,
  getTrackedWalletsForUser,
  removeTrackedWallet,
  setTrackedWalletActive,
} from '../services/trackedWalletService.js';

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
        '🗑',
        `WALLET_REMOVE_${wallet.id}`,
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
      await ctx.answerCbQuery();

      await ctx.reply(
        [
          '➕ <b>ADD WALLET</b>',
          '',
          'Send:',
          '',
          '<code>/trackwallet WALLET_ADDRESS optional label</code>',
          '',
          'Example:',
          '<code>/trackwallet 7Ks...R9d Whale Alpha</code>',
          '',
          'Only public wallet addresses are required.',
        ].join(
          '\n',
        ),
        {
          parse_mode:
            'HTML',
        },
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

  console.log(
    '[WalletTracking] Registered.',
  );
}
