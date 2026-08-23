import {
  type Telegraf,
} from 'telegraf';

import {
  supabase,
} from '../services/supabase.js';

import {
  resolveTokenOpenTarget,
} from '../core/tokenOpenRouter.js';

import {
  getTrackedOpportunities,
  trackOpportunity,
  untrackOpportunity,
} from '../services/opportunityWatchlistService.js';

import {
  escapeTelegramHtml,
} from './walletInput.js';
import { requireCapability } from './accessControl.js';
import { strategyDisplay } from '../product/strategyPresentation.js';

type OpportunityRow = {
  id: number;
  asset_id: string;
  chain: string | null;
  strategy_key: string | null;
  recommended_action: string | null;
  status: string | null;
};

function telegramId(
  ctx: any,
): string | null {
  const id =
    ctx.from?.id;

  return id == null
    ? null
    : String(id);
}

async function loadOpportunity(
  id: number,
): Promise<OpportunityRow | null> {
  const {
    data,
    error,
  } =
    await supabase
      .from('opportunities')
      .select(`
        id,
        asset_id,
        chain,
        strategy_key,
        recommended_action,
        status
      `)
      .eq(
        'id',
        id,
      )
      .maybeSingle();

  if (error) {
    throw error;
  }

  return (
    data as OpportunityRow | null
  );
}

export function
registerOpportunityActions(
  bot: Telegraf<any>,
) {
  bot.action(
    /^OPP_TRACK_(\d+)$/,
    async ctx => {
      try {
        if (!await requireCapability(ctx, 'watchlist.use', 'OPPORTUNITY_CENTER')) return;
        await ctx.answerCbQuery(
          'Tracking opportunity…',
        );

        const id =
          Number(
            ctx.match[1],
          );

        const userId =
          telegramId(
            ctx,
          );

        if (!userId) {
          return;
        }

        const opportunity =
          await loadOpportunity(
            id,
          );

        if (!opportunity) {
          await ctx.reply(
            'This opportunity is no longer available.',
          );

          return;
        }

        await trackOpportunity({
          opportunityId:
            id,

          telegramId:
            userId,
        });

        await ctx.reply(
          [
            '👀 <b>TRACKING</b>',
            '',
            'AlphaOS will keep this opportunity in your tracked set.',
            '',
            `<code>${escapeTelegramHtml(opportunity.asset_id)}</code>`,
          ].join(
            '\n',
          ),
          {
            parse_mode:
              'HTML',
            reply_markup: {
              inline_keyboard: [[
                { text: '👀 Watchlist', callback_data: 'OPP_WATCHLIST' },
                { text: '🏠 Home', callback_data: 'MAIN_MENU' },
              ]],
            },
          },
        );
      } catch (error) {
        console.error(
          '[OpportunityActions] Track failed:',
          error,
        );

        try {
          await ctx.answerCbQuery(
            'Could not track opportunity',
            {
              show_alert:
                true,
            },
          );
        } catch {
          // ignored
        }

        await ctx.reply(
          'Could not update your watchlist. Please try again.',
        ).catch(() => {});
      }
    },
  );

  bot.action(
    /^OPP_UNTRACK_(\d+)$/,
    async ctx => {
      if (!await requireCapability(ctx, 'watchlist.use', 'OPPORTUNITY_CENTER')) return;
      const userId = telegramId(ctx);
      if (!userId) return;

      try {
        await ctx.answerCbQuery('Updating watchlist…');
        await untrackOpportunity({
          opportunityId: Number(ctx.match[1]),
          telegramId: userId,
        });
        await ctx.reply('✅ Opportunity removed from your watchlist.');
      } catch (error) {
        console.error('[OpportunityActions] Untrack failed:', error);
        await ctx.answerCbQuery('Could not update watchlist', {
          show_alert: true,
        }).catch(() => {});
      }
    },
  );

  bot.action(
    'OPP_WATCHLIST',
    async ctx => {
      if (!await requireCapability(ctx, 'watchlist.use', 'OPPORTUNITY_CENTER')) return;
      const userId = telegramId(ctx);
      if (!userId) return;

      try {
        await ctx.answerCbQuery();
        const rows = await getTrackedOpportunities(userId, 10);

        const lines: string[] = [
          '👀 <b>MY WATCHLIST</b>',
          '',
          rows.length ? `Tracked opportunities: <b>${rows.length}</b>` : 'No tracked opportunities yet.',
          '',
        ];

        const buttons = rows.map(row => {
          const opportunity: any = Array.isArray(row.opportunities)
            ? row.opportunities[0]
            : row.opportunities;
          const strategy = strategyDisplay(opportunity?.strategy_key);
          const state = String(opportunity?.recommended_action ?? opportunity?.status ?? 'WATCH')
            .replace(/_/g, ' ');
          lines.push(
            `<b>${escapeTelegramHtml(opportunity?.title ?? opportunity?.asset_id ?? `Opportunity ${row.opportunity_id}`)}</b>`,
            `${escapeTelegramHtml(strategy.name)} · ${escapeTelegramHtml(state)}`,
            '',
          );
          return [{
            text: `Open ${String(opportunity?.title ?? row.opportunity_id).slice(0, 28)}`,
            callback_data: `OPP_VIEW_${row.opportunity_id}`,
          }];
        });
        buttons.push([
          { text: '⬅️ Opportunities', callback_data: 'OPPORTUNITY_CENTER' },
          { text: '🏠 Home', callback_data: 'MAIN_MENU' },
        ]);

        await ctx.reply(lines.join('\n'), {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buttons },
        });
      } catch (error) {
        console.error('[OpportunityActions] Watchlist failed:', error);
        await ctx.answerCbQuery('Could not load watchlist', {
          show_alert: true,
        }).catch(() => {});
      }
    },
  );

  /*
   * Execution entry point.
   *
   * This intentionally performs capability resolution BEFORE
   * any trade call. Never route an EVM/PONS token through the
   * Solana Jupiter admin trader.
   *
   * Solana opportunities reuse the existing proven admin BUY
   * callbacks today. Robinhood/PONS becomes executable when its
   * dedicated execution adapter is installed.
   */
  bot.action(
    /^OPP_TRADE_(\d+)$/,
    async ctx => {
      try {
        if (!await requireCapability(ctx, 'trading.admin', 'OPPORTUNITY_CENTER')) return;
        const id =
          Number(
            ctx.match[1],
          );

        const opportunity =
          await loadOpportunity(
            id,
          );

        if (!opportunity) {
          await ctx.answerCbQuery(
            'Opportunity expired',
            {
              show_alert:
                true,
            },
          );

          return;
        }

        const chain =
          String(
            opportunity.chain ??
            '',
          ).toLowerCase();

        if (
          chain ===
          'solana'
        ) {
          await ctx.answerCbQuery();

          await ctx.reply(
            'Choose trade size:',
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text:
                        '🟢 Buy Small',

                      callback_data:
                        `ADMIN_BUY_SMALL_${opportunity.asset_id}`,
                    },

                    {
                      text:
                        '🟢 Buy Default',

                      callback_data:
                        `ADMIN_BUY_DEFAULT_${opportunity.asset_id}`,
                    },
                  ],
                ],
              },
            },
          );

          return;
        }

        if (
          chain ===
            'robinhood' ||
          chain ===
            'pons'
        ) {
          await ctx.answerCbQuery(
            'Direct trading is unavailable for this market. Review it using the token link.',
            {
              show_alert:
                true,
            },
          );

          return;
        }

        await ctx.answerCbQuery(
          'Direct execution is not enabled for this chain yet.',
          {
            show_alert:
              true,
          },
        );
      } catch (error) {
        console.error(
          '[OpportunityActions] Trade action failed:',
          error,
        );

        try {
          await ctx.answerCbQuery(
            'Trade action unavailable',
            {
              show_alert:
                true,
            },
          );
        } catch {
          // ignored
        }
      }
    },
  );

  /*
   * Handy callback route for screens where a URL button is
   * not practical. It resolves through the same Smart Token
   * Router used everywhere else.
   */
  bot.action(
    /^OPP_MARKET_(\d+)$/,
    async ctx => {
      try {
        const opportunity =
          await loadOpportunity(
            Number(
              ctx.match[1],
            ),
          );

        if (!opportunity) {
          await ctx.answerCbQuery(
            'Opportunity expired',
            {
              show_alert:
                true,
            },
          );

          return;
        }

        const target =
          await resolveTokenOpenTarget({
            chain:
              opportunity.chain,

            tokenAddress:
              opportunity.asset_id,
          });

        await ctx.answerCbQuery();

        await ctx.reply(
          '📊 Open market:',
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text:
                      target.label,

                    url:
                      target.url,
                  },
                ],
              ],
            },
          },
        );
      } catch (error) {
        console.error(
          '[OpportunityActions] Market action failed:',
          error,
        );
      }
    },
  );

  console.log(
    '[OpportunityActions] Registered.',
  );
}
