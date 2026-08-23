import type { Telegraf } from 'telegraf';

import { config } from '../../config.js';
import { getTerminalStats } from '../../terminal/terminalStats.js';
import { buildTerminalMessage } from '../../terminal/terminalBuilder.js';

import {
  getAlphaSettings,
  updateAlphaSetting,
} from '../../services/settingsService.js';

import {
  isAutoTradePaused,
} from '../../core/autoTradeManager.js';

function isAdmin(telegramId: string): boolean {
  return telegramId === config.adminTelegramId;
}

function formatSol(value: number): string {
  return `${value.toFixed(value < 0.1 ? 3 : 2)} SOL`;
}

function enabledLabel(value: boolean): string {
  return value ? '✅ ON' : '❌ OFF';
}

function terminalKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: '📈 Positions',
          callback_data: 'POSITIONS',
        },
        {
          text: '💰 Wallet',
          callback_data: 'WALLET',
        },
      ],
      [
        {
          text: '🤖 Auto Trade',
          callback_data: 'AUTO_TRADE_STATUS',
        },
        {
          text: '⚙️ Trade Settings',
          callback_data: 'ADMIN_TRADE_SETTINGS',
        },
      ],
      [
        {
          text: '🛒 Trading',
          callback_data: 'TRADE_MENU',
        },
      ],
      [
        {
          text: '⏸ Pause Auto Trade',
          callback_data: 'PAUSE_AUTO_TRADE',
        },
        {
          text: '▶️ Resume Auto Trade',
          callback_data: 'RESUME_AUTO_TRADE',
        },
      ],
      [
        {
          text: '📊 Performance',
          callback_data: 'ADMIN_TERMINAL_PERFORMANCE',
        },
        {
          text: '⚡ API Health',
          callback_data: 'ADMIN_TERMINAL_HEALTH',
        },
      ],
      [
        {
          text: '📚 Alpha Memory',
          callback_data: 'ADMIN_TERMINAL_MEMORY',
        },
        {
          text: '🔄 Refresh',
          callback_data: 'ADMIN_TERMINAL_REFRESH',
        },
      ],
      [
        {
          text: '🏠 Home',
          callback_data: 'MAIN_MENU',
        },
      ],
    ],
  };
}

function backToTerminalKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: '⬅️ Trading Cockpit',
          callback_data: 'ADMIN_TERMINAL_REFRESH',
        },
      ],
    ],
  };
}

function tradingSettingsKeyboard(args: {
  autoBuyEnabled: boolean;
  trailingStopEnabled: boolean;
  paused: boolean;
  executionMode: 'paper' | 'live';
}) {
  return {
    inline_keyboard: [
      [
        {
          text:
            args.executionMode === 'paper'
              ? '🧪 Mode: PAPER'
              : '🔴 Mode: LIVE',
          callback_data: 'ATS_TOGGLE_EXECUTION_MODE',
        },
      ],
      [
        {
          text: args.autoBuyEnabled
            ? '🟢 Auto Buy: ON'
            : '🔴 Auto Buy: OFF',
          callback_data: 'ATS_TOGGLE_AUTO_BUY',
        },
      ],
      [
        {
          text: '💰 Trade Size',
          callback_data: 'ATS_TRADE_SIZE_MENU',
        },
        {
          text: '📊 Max Positions',
          callback_data: 'ATS_MAX_POSITIONS_MENU',
        },
      ],
      [
        {
          text: '🛑 Stop Loss',
          callback_data: 'ATS_STOP_LOSS_MENU',
        },
        {
          text: args.trailingStopEnabled
            ? '📈 Trailing: ON'
            : '📉 Trailing: OFF',
          callback_data: 'ATS_TOGGLE_TRAILING',
        },
      ],
      [
        {
          text: '⏱ Confirmation',
          callback_data: 'ATS_CONFIRMATION_MENU',
        },
      ],
      [
        {
          text: '📉 Entry Dip',
          callback_data: 'ATS_ENTRY_DIP_MENU',
        },
        {
          text: '🚀 Entry Pump',
          callback_data: 'ATS_ENTRY_PUMP_MENU',
        },
      ],
      [
        {
          text: args.paused
            ? '▶️ Resume Engine'
            : '⏸ Pause Engine',
          callback_data: args.paused
            ? 'RESUME_AUTO_TRADE'
            : 'PAUSE_AUTO_TRADE',
        },
      ],
      [
        {
          text: '🔄 Refresh',
          callback_data: 'ADMIN_TRADE_SETTINGS',
        },
        {
          text: '⬅️ Cockpit',
          callback_data: 'ADMIN_TERMINAL_REFRESH',
        },
      ],
    ],
  };
}

function tradeSizeKeyboard(currentValue: number) {
  const values = [
    0.01,
    0.025,
    0.03,
    0.05,
    0.1,
  ];

  return {
    inline_keyboard: [
      ...values.map((value) => [
        {
          text: `${
            Math.abs(currentValue - value) < 0.000001 ? '✅ ' : ''
          }${formatSol(value)}`,
          callback_data: `ATS_SET_SIZE_${value}`,
        },
      ]),
      [
        {
          text: '⬅️ Trade Settings',
          callback_data: 'ADMIN_TRADE_SETTINGS',
        },
      ],
    ],
  };
}

function maxPositionsKeyboard(currentValue: number) {
  const values = [1, 2, 3, 5];

  return {
    inline_keyboard: [
      [
        ...values.map((value) => ({
          text: `${
            currentValue === value ? '✅ ' : ''
          }${value}`,
          callback_data: `ATS_SET_MAX_POS_${value}`,
        })),
      ],
      [
        {
          text: '⬅️ Trade Settings',
          callback_data: 'ADMIN_TRADE_SETTINGS',
        },
      ],
    ],
  };
}

function stopLossKeyboard(currentValue: number) {
  const values = [5, 8, 10, 12, 15, 20];

  return {
    inline_keyboard: [
      [
        ...values.slice(0, 3).map((value) => ({
          text: `${
            currentValue === value ? '✅ ' : ''
          }${value}%`,
          callback_data: `ATS_SET_STOP_${value}`,
        })),
      ],
      [
        ...values.slice(3).map((value) => ({
          text: `${
            currentValue === value ? '✅ ' : ''
          }${value}%`,
          callback_data: `ATS_SET_STOP_${value}`,
        })),
      ],
      [
        {
          text: '⬅️ Trade Settings',
          callback_data: 'ADMIN_TRADE_SETTINGS',
        },
      ],
    ],
  };
}

function confirmationKeyboard(currentValue: number) {
  const values = [10, 15, 20, 30, 45, 60];

  return {
    inline_keyboard: [
      [
        ...values.slice(0, 3).map((value) => ({
          text: `${
            currentValue === value ? '✅ ' : ''
          }${value}s`,
          callback_data: `ATS_SET_CONFIRM_${value}`,
        })),
      ],
      [
        ...values.slice(3).map((value) => ({
          text: `${
            currentValue === value ? '✅ ' : ''
          }${value}s`,
          callback_data: `ATS_SET_CONFIRM_${value}`,
        })),
      ],
      [
        {
          text: '⬅️ Trade Settings',
          callback_data: 'ADMIN_TRADE_SETTINGS',
        },
      ],
    ],
  };
}

function entryDipKeyboard(currentValue: number) {
  const values = [2, 3, 5, 7, 10];

  return {
    inline_keyboard: [
      [
        ...values.slice(0, 3).map((value) => ({
          text: `${
            currentValue === value ? '✅ ' : ''
          }${value}%`,
          callback_data: `ATS_SET_DIP_${value}`,
        })),
      ],
      [
        ...values.slice(3).map((value) => ({
          text: `${
            currentValue === value ? '✅ ' : ''
          }${value}%`,
          callback_data: `ATS_SET_DIP_${value}`,
        })),
      ],
      [
        {
          text: '⬅️ Trade Settings',
          callback_data: 'ADMIN_TRADE_SETTINGS',
        },
      ],
    ],
  };
}

function entryPumpKeyboard(currentValue: number) {
  const values = [5, 8, 10, 12, 15, 20];

  return {
    inline_keyboard: [
      [
        ...values.slice(0, 3).map((value) => ({
          text: `${
            currentValue === value ? '✅ ' : ''
          }${value}%`,
          callback_data: `ATS_SET_PUMP_${value}`,
        })),
      ],
      [
        ...values.slice(3).map((value) => ({
          text: `${
            currentValue === value ? '✅ ' : ''
          }${value}%`,
          callback_data: `ATS_SET_PUMP_${value}`,
        })),
      ],
      [
        {
          text: '⬅️ Trade Settings',
          callback_data: 'ADMIN_TRADE_SETTINGS',
        },
      ],
    ],
  };
}

async function editOrReply(
  ctx: any,
  message: string,
  replyMarkup: any,
): Promise<void> {
  const options = {
    parse_mode: 'HTML' as const,
    reply_markup: replyMarkup,
  };

  try {
    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(message, options);
      return;
    }

    await ctx.reply(message, options);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('message is not modified')) {
      return;
    }

    console.error('editOrReply error:', error);
    await ctx.reply(message, options);
  }
}

async function renderTerminal(ctx: any): Promise<void> {
  const stats = await getTerminalStats();
  const message = buildTerminalMessage(stats);

  await editOrReply(
    ctx,
    message,
    terminalKeyboard(),
  );
}

async function renderTradingSettings(ctx: any): Promise<void> {
  const settings = await getAlphaSettings(true);
  const paused = isAutoTradePaused();

  const message = [
    '⚙️ <b>ADMIN TRADING SETTINGS</b>',
    '━━━━━━━━━━━━━━━━━━',
    '',
    `Auto Buy: <b>${enabledLabel(
      settings.adminAutoBuyEnabled,
    )}</b>`,
    `Trading Mode: <b>${settings.executionMode.toUpperCase()}</b>`,
    `Engine: <b>${paused ? '⏸ PAUSED' : '▶️ RUNNING'}</b>`,
    '',
    `Trade Size: <b>${formatSol(
      settings.adminTradeAmountSol,
    )}</b>`,
    `Max Positions: <b>${settings.maxOpenPositions}</b>`,
    '',
    `Initial Stop: <b>${settings.initialStopLossPercent}%</b>`,
    `Trailing Stop: <b>${enabledLabel(
      settings.trailingStopEnabled,
    )}</b>`,
    '',
    `Confirmation: <b>${settings.entryConfirmationSeconds}s</b>`,
    `Maximum Entry Dip: <b>${settings.maxEntryDipPercent}%</b>`,
    `Maximum Entry Pump: <b>${settings.maxEntryPumpPercent}%</b>`,
    '',
    'Changes apply to future entries without restarting AlphaOS.',
    '',
    '⚠️ Existing open positions keep their current stop price.',
  ].join('\n');

  await editOrReply(
    ctx,
    message,
    tradingSettingsKeyboard({
      autoBuyEnabled: settings.adminAutoBuyEnabled,
      trailingStopEnabled: settings.trailingStopEnabled,
      paused,
      executionMode: settings.executionMode,
    }),
  );
}

async function rejectNonAdminCommand(ctx: any): Promise<boolean> {
  const telegramId = String(ctx.from?.id ?? '');

  if (isAdmin(telegramId)) {
    return false;
  }

  await ctx.reply('⛔ Admin only.');
  return true;
}

async function rejectNonAdminAction(ctx: any): Promise<boolean> {
  const telegramId = String(ctx.from?.id ?? '');

  if (isAdmin(telegramId)) {
    return false;
  }

  await ctx.answerCbQuery('Admin only', {
    show_alert: true,
  });

  return true;
}

async function updateSettingAndReturn(args: {
  ctx: any;
  key: string;
  value: unknown;
  confirmation: string;
}): Promise<void> {
  await updateAlphaSetting(args.key, args.value);

  await args.ctx.answerCbQuery(args.confirmation);

  await renderTradingSettings(args.ctx);
}

export function registerAdminTerminal(
  bot: Telegraf<any>,
): void {
  bot.command('terminal', async (ctx) => {
    if (await rejectNonAdminCommand(ctx)) {
      return;
    }

    try {
      await renderTerminal(ctx);
    } catch (error) {
      console.error('terminal command error:', error);

      await ctx.reply(
        `❌ Terminal failed: ${
          error instanceof Error
            ? error.message
            : 'Unknown error'
        }`,
      );
    }
  });

  bot.action(
    'ADMIN_TERMINAL_REFRESH',
    async (ctx) => {
      if (await rejectNonAdminAction(ctx)) {
        return;
      }

      await ctx.answerCbQuery(
        'Refreshing AlphaOS...',
      );

      try {
        await renderTerminal(ctx);
      } catch (error) {
        console.error(
          'terminal refresh error:',
          error,
        );

        await ctx.reply(
          '❌ Unable to refresh the trading cockpit.',
        );
      }
    },
  );

  bot.action(
    'ADMIN_TRADE_SETTINGS',
    async (ctx) => {
      if (await rejectNonAdminAction(ctx)) {
        return;
      }

      await ctx.answerCbQuery();

      try {
        await renderTradingSettings(ctx);
      } catch (error) {
        console.error(
          'trade settings error:',
          error,
        );

        await ctx.reply(
          `❌ Unable to load trading settings: ${
            error instanceof Error
              ? error.message
              : 'Unknown error'
          }`,
        );
      }
    },
  );

  bot.action(
    'ATS_TOGGLE_AUTO_BUY',
    async (ctx) => {
      if (await rejectNonAdminAction(ctx)) {
        return;
      }

      try {
        const settings =
          await getAlphaSettings(true);

        const nextValue =
          !settings.adminAutoBuyEnabled;

        await updateSettingAndReturn({
          ctx,
          key: 'admin_auto_buy_enabled',
          value: nextValue,
          confirmation: nextValue
            ? 'Auto buy enabled'
            : 'Auto buy disabled',
        });
      } catch (error) {
        console.error(
          'toggle auto buy error:',
          error,
        );

        await ctx.answerCbQuery(
          'Update failed',
          { show_alert: true },
        );
      }
    },
  );

  bot.action(
  'ATS_TOGGLE_EXECUTION_MODE',
  async (ctx) => {
    if (await rejectNonAdminAction(ctx)) {
      return;
    }

    try {
      const settings =
        await getAlphaSettings(true);

      if (settings.executionMode === 'live') {
        await updateSettingAndReturn({
          ctx,
          key: 'execution_mode',
          value: 'paper',
          confirmation: 'Paper trading enabled',
        });

        return;
      }

      await ctx.answerCbQuery();

      await editOrReply(
        ctx,
        [
          '⚠️ <b>ENABLE LIVE TRADING?</b>',
          '━━━━━━━━━━━━━━━━━━',
          '',
          'Future qualified entries will use real SOL.',
          `Trade Size: <b>${formatSol(
            settings.adminTradeAmountSol,
          )}</b>`,
          '',
          'Confirm only when the trading wallet is ready.',
        ].join('\n'),
        {
          inline_keyboard: [
            [
              {
                text: '✅ Confirm LIVE',
                callback_data:
                  'ATS_CONFIRM_LIVE_MODE',
              },
            ],
            [
              {
                text: 'Cancel',
                callback_data:
                  'ADMIN_TRADE_SETTINGS',
              },
            ],
          ],
        },
      );
    } catch (error) {
      console.error(
        'execution mode toggle error:',
        error,
      );

      await ctx.answerCbQuery(
        'Mode update failed',
        { show_alert: true },
      );
    }
  },
);

bot.action(
  'ATS_CONFIRM_LIVE_MODE',
  async (ctx) => {
    if (await rejectNonAdminAction(ctx)) {
      return;
    }

    try {
      await updateSettingAndReturn({
        ctx,
        key: 'execution_mode',
        value: 'live',
        confirmation: 'Live trading enabled',
      });
    } catch (error) {
      console.error(
        'live mode confirmation error:',
        error,
      );

      await ctx.answerCbQuery(
        'Live mode update failed',
        { show_alert: true },
      );
    }
  },
);

  bot.action(
    'ATS_TOGGLE_TRAILING',
    async (ctx) => {
      if (await rejectNonAdminAction(ctx)) {
        return;
      }

      try {
        const settings =
          await getAlphaSettings(true);

        const nextValue =
          !settings.trailingStopEnabled;

        await updateSettingAndReturn({
          ctx,
          key: 'trailing_stop_enabled',
          value: nextValue,
          confirmation: nextValue
            ? 'Trailing stop enabled'
            : 'Trailing stop disabled',
        });
      } catch (error) {
        console.error(
          'toggle trailing stop error:',
          error,
        );

        await ctx.answerCbQuery(
          'Update failed',
          { show_alert: true },
        );
      }
    },
  );

  bot.action(
    'ATS_TRADE_SIZE_MENU',
    async (ctx) => {
      if (await rejectNonAdminAction(ctx)) {
        return;
      }

      await ctx.answerCbQuery();

      const settings =
        await getAlphaSettings(true);

      await editOrReply(
        ctx,
        [
          '💰 <b>AUTO-BUY TRADE SIZE</b>',
          '',
          `Current: <b>${formatSol(
            settings.adminTradeAmountSol,
          )}</b>`,
          '',
          'Choose the SOL amount AlphaOS will use for each future automated entry.',
        ].join('\n'),
        tradeSizeKeyboard(
          settings.adminTradeAmountSol,
        ),
      );
    },
  );

  bot.action(
    /^ATS_SET_SIZE_(0\.01|0\.025|0\.03|0\.05|0\.1)$/,
    async (ctx) => {
      if (await rejectNonAdminAction(ctx)) {
        return;
      }

      const value = Number(
        (ctx.match as RegExpExecArray)[1],
      );

      try {
        await updateSettingAndReturn({
          ctx,
          key: 'admin_trade_amount_sol',
          value,
          confirmation: `Trade size set to ${value} SOL`,
        });
      } catch (error) {
        console.error(
          'trade size update error:',
          error,
        );

        await ctx.answerCbQuery(
          'Trade size update failed',
          { show_alert: true },
        );
      }
    },
  );

  bot.action(
    'ATS_MAX_POSITIONS_MENU',
    async (ctx) => {
      if (await rejectNonAdminAction(ctx)) {
        return;
      }

      await ctx.answerCbQuery();

      const settings =
        await getAlphaSettings(true);

      await editOrReply(
        ctx,
        [
          '📊 <b>MAXIMUM OPEN POSITIONS</b>',
          '',
          `Current: <b>${settings.maxOpenPositions}</b>`,
          '',
          'AlphaOS will not open another trade after reaching this limit.',
        ].join('\n'),
        maxPositionsKeyboard(
          settings.maxOpenPositions,
        ),
      );
    },
  );

  bot.action(
    /^ATS_SET_MAX_POS_(1|2|3|5)$/,
    async (ctx) => {
      if (await rejectNonAdminAction(ctx)) {
        return;
      }

      const value = Number(
        (ctx.match as RegExpExecArray)[1],
      );

      try {
        await updateSettingAndReturn({
          ctx,
          key: 'max_open_positions',
          value,
          confirmation: `Maximum positions set to ${value}`,
        });
      } catch (error) {
        console.error(
          'max positions update error:',
          error,
        );

        await ctx.answerCbQuery(
          'Update failed',
          { show_alert: true },
        );
      }
    },
  );

  bot.action(
    'ATS_STOP_LOSS_MENU',
    async (ctx) => {
      if (await rejectNonAdminAction(ctx)) {
        return;
      }

      await ctx.answerCbQuery();

      const settings =
        await getAlphaSettings(true);

      await editOrReply(
        ctx,
        [
          '🛑 <b>INITIAL STOP LOSS</b>',
          '',
          `Current: <b>${settings.initialStopLossPercent}%</b>`,
          '',
          'This applies when a new position is opened.',
          '',
          'Existing positions keep their saved stop price.',
        ].join('\n'),
        stopLossKeyboard(
          settings.initialStopLossPercent,
        ),
      );
    },
  );

  bot.action(
    /^ATS_SET_STOP_(5|8|10|12|15|20)$/,
    async (ctx) => {
      if (await rejectNonAdminAction(ctx)) {
        return;
      }

      const value = Number(
        (ctx.match as RegExpExecArray)[1],
      );

      try {
        await updateSettingAndReturn({
          ctx,
          key: 'initial_stop_loss_percent',
          value,
          confirmation: `Initial stop set to ${value}%`,
        });
      } catch (error) {
        console.error(
          'stop loss update error:',
          error,
        );

        await ctx.answerCbQuery(
          'Update failed',
          { show_alert: true },
        );
      }
    },
  );

  bot.action(
    'ATS_CONFIRMATION_MENU',
    async (ctx) => {
      if (await rejectNonAdminAction(ctx)) {
        return;
      }

      await ctx.answerCbQuery();

      const settings =
        await getAlphaSettings(true);

      await editOrReply(
        ctx,
        [
          '⏱ <b>ENTRY CONFIRMATION WINDOW</b>',
          '',
          `Current: <b>${settings.entryConfirmationSeconds} seconds</b>`,
          '',
          'AlphaOS waits this long before confirming and executing an automated entry.',
        ].join('\n'),
        confirmationKeyboard(
          settings.entryConfirmationSeconds,
        ),
      );
    },
  );

  bot.action(
    /^ATS_SET_CONFIRM_(10|15|20|30|45|60)$/,
    async (ctx) => {
      if (await rejectNonAdminAction(ctx)) {
        return;
      }

      const value = Number(
        (ctx.match as RegExpExecArray)[1],
      );

      try {
        await updateSettingAndReturn({
          ctx,
          key: 'entry_confirmation_seconds',
          value,
          confirmation: `Confirmation set to ${value}s`,
        });
      } catch (error) {
        console.error(
          'confirmation update error:',
          error,
        );

        await ctx.answerCbQuery(
          'Update failed',
          { show_alert: true },
        );
      }
    },
  );

  bot.action(
    'ATS_ENTRY_DIP_MENU',
    async (ctx) => {
      if (await rejectNonAdminAction(ctx)) {
        return;
      }

      await ctx.answerCbQuery();

      const settings =
        await getAlphaSettings(true);

      await editOrReply(
        ctx,
        [
          '📉 <b>MAXIMUM ENTRY DIP</b>',
          '',
          `Current: <b>${settings.maxEntryDipPercent}%</b>`,
          '',
          'The trade is cancelled when price falls beyond this percentage during confirmation.',
        ].join('\n'),
        entryDipKeyboard(
          settings.maxEntryDipPercent,
        ),
      );
    },
  );

  bot.action(
    /^ATS_SET_DIP_(2|3|5|7|10)$/,
    async (ctx) => {
      if (await rejectNonAdminAction(ctx)) {
        return;
      }

      const value = Number(
        (ctx.match as RegExpExecArray)[1],
      );

      try {
        await updateSettingAndReturn({
          ctx,
          key: 'max_entry_dip_percent',
          value,
          confirmation: `Maximum dip set to ${value}%`,
        });
      } catch (error) {
        console.error(
          'entry dip update error:',
          error,
        );

        await ctx.answerCbQuery(
          'Update failed',
          { show_alert: true },
        );
      }
    },
  );

  bot.action(
    'ATS_ENTRY_PUMP_MENU',
    async (ctx) => {
      if (await rejectNonAdminAction(ctx)) {
        return;
      }

      await ctx.answerCbQuery();

      const settings =
        await getAlphaSettings(true);

      await editOrReply(
        ctx,
        [
          '🚀 <b>MAXIMUM ENTRY PUMP</b>',
          '',
          `Current: <b>${settings.maxEntryPumpPercent}%</b>`,
          '',
          'The trade is cancelled when price rises beyond this percentage before entry.',
        ].join('\n'),
        entryPumpKeyboard(
          settings.maxEntryPumpPercent,
        ),
      );
    },
  );

  bot.action(
    /^ATS_SET_PUMP_(5|8|10|12|15|20)$/,
    async (ctx) => {
      if (await rejectNonAdminAction(ctx)) {
        return;
      }

      const value = Number(
        (ctx.match as RegExpExecArray)[1],
      );

      try {
        await updateSettingAndReturn({
          ctx,
          key: 'max_entry_pump_percent',
          value,
          confirmation: `Maximum pump set to ${value}%`,
        });
      } catch (error) {
        console.error(
          'entry pump update error:',
          error,
        );

        await ctx.answerCbQuery(
          'Update failed',
          { show_alert: true },
        );
      }
    },
  );

  bot.action(
    'ADMIN_TERMINAL_MEMORY',
    async (ctx) => {
      if (await rejectNonAdminAction(ctx)) {
        return;
      }

      await ctx.answerCbQuery();

      try {
        const stats = await getTerminalStats();

        await ctx.reply(
          [
            '📚 <b>ALPHA MEMORY</b>',
            '━━━━━━━━━━━━━━━━━━',
            '',
            `Tracked Tokens: <b>${stats.tokensTracked}</b>`,
            `Timeline Events: <b>${stats.timelineEvents}</b>`,
            `Alerts Today: <b>${stats.alertsToday}</b>`,
            `BUY Signals Today: <b>${stats.buysToday}</b>`,
            '',
            '<b>Alpha Memory records:</b>',
            '• Alert market state',
            '• Market-cap changes',
            '• Liquidity changes',
            '• Price evolution',
            '• Signal outcomes',
            '',
            '🧠 This data powers AlphaOS adaptive learning.',
          ].join('\n'),
          {
            parse_mode: 'HTML',
            reply_markup:
              backToTerminalKeyboard(),
          },
        );
      } catch (error) {
        console.error(
          'terminal memory error:',
          error,
        );

        await ctx.reply(
          '❌ Unable to load Alpha Memory.',
        );
      }
    },
  );

  bot.action(
    'ADMIN_TERMINAL_PERFORMANCE',
    async (ctx) => {
      if (await rejectNonAdminAction(ctx)) {
        return;
      }

      await ctx.answerCbQuery();

      try {
        const stats = await getTerminalStats();

        const latestBuyMessage =
          stats.latestBuy
            ? [
                '🚀 <b>Latest BUY Signal</b>',
                `Token: <b>${stats.latestBuy.symbol}</b>`,
                `Score: <b>${
                  stats.latestBuy.score ??
                  'Tracking'
                }/100</b>`,
                `Market Cap: <b>${
                  stats.latestBuy.marketCap !=
                  null
                    ? `$${Math.round(
                        stats.latestBuy
                          .marketCap,
                      ).toLocaleString()}`
                    : 'Tracking'
                }</b>`,
              ].join('\n')
            : 'No BUY signal recorded today.';

        await ctx.reply(
          [
            '📊 <b>ALPHAOS PERFORMANCE</b>',
            '━━━━━━━━━━━━━━━━━━',
            '',
            `Alerts Today: <b>${stats.alertsToday}</b>`,
            `BUY Signals Today: <b>${stats.buysToday}</b>`,
            '',
            latestBuyMessage,
            '',
            'AlphaOS continues tracking outcomes and market behaviour.',
          ].join('\n'),
          {
            parse_mode: 'HTML',
            reply_markup:
              backToTerminalKeyboard(),
          },
        );
      } catch (error) {
        console.error(
          'terminal performance error:',
          error,
        );

        await ctx.reply(
          '❌ Unable to load performance data.',
        );
      }
    },
  );

  bot.action(
    'ADMIN_TERMINAL_HEALTH',
    async (ctx) => {
      if (await rejectNonAdminAction(ctx)) {
        return;
      }

      await ctx.answerCbQuery();

      try {
        const stats = await getTerminalStats();

        await ctx.reply(
          [
            '⚡ <b>ALPHAOS API HEALTH</b>',
            '━━━━━━━━━━━━━━━━━━',
            '',
            `DexScreener: <b>${stats.apiStatus.dexScreener}</b>`,
            `Helius: <b>${stats.apiStatus.helius}</b>`,
            `Bitquery: <b>${stats.apiStatus.bitquery}</b>`,
            `Pump.fun: <b>${stats.apiStatus.pumpfun}</b>`,
            '',
            '⚠️ Service values currently reflect the latest known state.',
          ].join('\n'),
          {
            parse_mode: 'HTML',
            reply_markup:
              backToTerminalKeyboard(),
          },
        );
      } catch (error) {
        console.error(
          'terminal health error:',
          error,
        );

        await ctx.reply(
          '❌ Unable to load API health.',
        );
      }
    },
  );
}
