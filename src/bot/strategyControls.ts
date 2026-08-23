import {
  Markup,
  type Telegraf,
} from 'telegraf';

import {
  getUserStrategyState,
  toggleUserStrategy,
} from '../services/strategyService.js';
import { strategyDisplay } from '../product/strategyPresentation.js';
import { escapeTelegramHtml } from '../ui/escapeHtml.js';
import { assertValidCallbackData } from './callbackData.js';
import { requireCapability } from './accessControl.js';

function chainLabel(chain: string): string {
  if (chain === 'solana') {
    return '🟣 SOLANA';
  }

  if (chain === 'robinhood') {
    return '🟢 ROBINHOOD / PONS';
  }

  return '🔥 MULTI-SIGNAL';
}

function strategyIcon(
  enabled: boolean,
): string {
  return enabled
    ? '✅'
    : '⭕';
}

async function renderStrategies(
  ctx: any,
): Promise<void> {
  const telegramId =
    String(
      ctx.from?.id ??
      '',
    );

  if (!telegramId) {
    return;
  }

  const strategies =
    await getUserStrategyState(
      telegramId,
    );

  const lines: string[] = [
    '🎯 <b>ALERT STRATEGIES</b>',
    '',
    'ON = AlphaOS may send normal alerts from this strategy.',
    'OFF = normal alerts from this strategy are muted.',
    '',
    '✅ ON · alerts enabled',
    '⭕ OFF · alerts muted',
    '',
  ];

  let currentChain = '';

  for (const strategy of strategies) {
    if (strategy.chain !== currentChain) {
      currentChain =
        strategy.chain;

      lines.push(
        `<b>${chainLabel(
          currentChain,
        )}</b>`,
      );
    }

    lines.push(
      `${
        strategyIcon(
          strategy.user_enabled,
        )
      } ${escapeTelegramHtml(strategyDisplay(
        strategy.strategy_key,
        strategy.name,
      ).name)}`,
    );
  }

  lines.push(
    '',
    'You can change these at any time.',
    '',
    'Risk/emergency protection may still send critical safety alerts.',
  );

  const buttons =
    strategies.map(
      strategy => [
        Markup.button.callback(
          `${
            strategyIcon(
              strategy.user_enabled,
            )
          } ${strategyDisplay(strategy.strategy_key, strategy.name).name}`,
          assertValidCallbackData(`STRAT_TOGGLE_${strategy.strategy_key}`),
        ),
      ],
    );

  buttons.push([
    Markup.button.callback(
      '🔄 Refresh',
      'STRATEGY_SETTINGS',
    ),

    Markup.button.callback(
      '⬅️ Controls',
      'SETTINGS',
    ),

    Markup.button.callback(
      '🏠 Home',
      'MAIN_MENU',
    ),
  ]);

  const extra = {
    parse_mode: 'HTML' as const,
    ...Markup.inlineKeyboard(
      buttons,
    ),
  };

  if (
    ctx.callbackQuery?.message
  ) {
    try {
      await ctx.editMessageText(
        lines.join('\n'),
        extra,
      );

      return;
    } catch {
      // Message may be unchanged or no longer editable.
    }
  }

  await ctx.reply(
    lines.join('\n'),
    extra,
  );
}

export function registerStrategyControls(
  bot: Telegraf<any>,
): void {
  bot.command(
    'strategies',
    async ctx => {
      try {
        await renderStrategies(
          ctx,
        );
      } catch (error) {
        console.error(
          '[StrategyControls] /strategies failed:',
          error,
        );

        await ctx.reply(
          '❌ Unable to load strategy settings.',
        );
      }
    },
  );

  bot.action(
    'STRATEGY_SETTINGS',
    async ctx => {
      if (!await requireCapability(ctx, 'strategies.manage', 'SETTINGS')) return;
      await ctx.answerCbQuery();

      try {
        await renderStrategies(
          ctx,
        );
      } catch (error) {
        console.error(
          '[StrategyControls] settings failed:',
          error,
        );

        await ctx.reply(
          '❌ Unable to load strategy settings.',
        );
      }
    },
  );

  bot.action(
    /^STRAT_TOGGLE_(.+)$/,
    async ctx => {
      if (!await requireCapability(ctx, 'strategies.manage', 'SETTINGS')) return;
      const strategyKey =
        ctx.match?.[1];

      if (!strategyKey) {
        await ctx.answerCbQuery(
          'Strategy not found',
          {
            show_alert: true,
          },
        );

        return;
      }

      const telegramId =
        String(
          ctx.from?.id ??
          '',
        );

      try {
        const enabled =
          await toggleUserStrategy({
            telegramId,
            strategyKey,
          });

        await ctx.answerCbQuery(
          enabled
            ? 'Strategy enabled ✅'
            : 'Strategy muted ⭕',
        );

        await renderStrategies(
          ctx,
        );
      } catch (error) {
        console.error(
          '[StrategyControls] toggle failed:',
          {
            telegramId,
            strategyKey,
            error,
          },
        );

        await ctx.answerCbQuery(
          'Update failed',
          {
            show_alert: true,
          },
        );
      }
    },
  );
}
