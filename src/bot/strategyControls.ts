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
  advanced = false,
): Promise<void> {
  const telegramId =
    String(
      ctx.from?.id ??
      '',
    );

  if (!telegramId) {
    return;
  }

  const all = await getUserStrategyState(telegramId);
  const primary = (key: string) => /^(DEX_PAID|BOOSTER_INSTANT|BOOST|SOCIAL_MAFIA|PROTOCOL_DISCOVERY|TRADE_SETUP_WATCH|ARC_OPPORTUNITY)$/.test(key.toUpperCase());
  const strategies = all.filter(strategy => advanced ? !primary(strategy.strategy_key) : primary(strategy.strategy_key));

  const lines: string[] = [
    advanced ? '⚙️ <b>ADVANCED PREFERENCES</b>' : '⚡ <b>ALERT PREFERENCES</b>',
    '',
    'ON/OFF controls your preference, not engine health.',
    'Delivery still requires a qualifying event and available data.',
    'Other feeds: Boost · Social Mafia · Protocol Discovery · Trade Setup · ARC Opportunity.',
    'These legacy preference switches do not control every feed.',
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
      ).name)}${strategy.enabled ? '' : ' · unavailable'}`,
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

  if (!advanced && buttons.length > 1) {
    const flat = buttons.flat(); buttons.length = 0;
    for (let i = 0; i < flat.length; i += 2) buttons.push(flat.slice(i, i + 2));
  }
  buttons.push([Markup.button.callback(advanced ? '‹ Main Preferences' : '⚙ Advanced · legacy strategies', advanced ? 'STRATEGY_SETTINGS' : 'STRATEGY_ADVANCED')]);
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

  bot.action('STRATEGY_ADVANCED', async ctx => {
    if (!await requireCapability(ctx, 'strategies.manage', 'SETTINGS')) return;
    await ctx.answerCbQuery().catch(() => {});
    try { await renderStrategies(ctx, true); }
    catch { await ctx.reply('Preferences unavailable. Please try again shortly.'); }
  });

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
