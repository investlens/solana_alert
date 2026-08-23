import {
  type Telegraf,
} from 'telegraf';

import {
  supabase,
} from '../services/supabase.js';

import {
  resolveTokenOpenTarget,
} from '../core/tokenOpenRouter.js';

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

/*
 * Tracking is persisted in the opportunity delivery metadata
 * rather than creating another isolated watch mechanism.
 *
 * This is intentionally user-scoped and can later be surfaced
 * identically in Telegram and the web app.
 */
async function markTracked(args: {
  opportunityId: number;
  telegramId: string;
}) {
  const {
    data: existing,
    error: lookupError,
  } =
    await supabase
      .from(
        'opportunity_deliveries',
      )
      .select(
        'id,metadata',
      )
      .eq(
        'opportunity_id',
        args.opportunityId,
      )
      .eq(
        'telegram_id',
        args.telegramId,
      )
      .eq(
        'delivery_channel',
        'telegram',
      )
      .maybeSingle();

  if (lookupError) {
    throw lookupError;
  }

  if (existing) {
    const metadata =
      (
        existing.metadata &&
        typeof existing.metadata ===
        'object'
      )
        ? existing.metadata as
          Record<string, unknown>
        : {};

    const {
      error,
    } =
      await supabase
        .from(
          'opportunity_deliveries',
        )
        .update({
          metadata: {
            ...metadata,

            tracked:
              true,

            tracked_at:
              new Date().toISOString(),
          },
        })
        .eq(
          'id',
          existing.id,
        );

    if (error) {
      throw error;
    }

    return;
  }

  /*
   * User may track from Opportunity Center even if no
   * Telegram delivery row exists yet.
   */
  const opportunity =
    await loadOpportunity(
      args.opportunityId,
    );

  if (!opportunity) {
    throw new Error(
      'Opportunity no longer exists',
    );
  }

  const {
    error,
  } =
    await supabase
      .from(
        'opportunity_deliveries',
      )
      .insert({
        opportunity_id:
          opportunity.id,

        telegram_id:
          args.telegramId,

        strategy_key:
          opportunity.strategy_key,

        chain:
          opportunity.chain,

        recommended_action:
          opportunity.recommended_action,

        delivery_channel:
          'telegram',

        metadata: {
          state:
            'TRACKED',

          tracked:
            true,

          tracked_at:
            new Date().toISOString(),
        },
      });

  if (error) {
    throw error;
  }
}

export function
registerOpportunityActions(
  bot: Telegraf<any>,
) {
  bot.action(
    /^OPP_TRACK_(\d+)$/,
    async ctx => {
      try {
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

        await markTracked({
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
            `<code>${opportunity.asset_id}</code>`,
          ].join(
            '\n',
          ),
          {
            parse_mode:
              'HTML',
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
            'PONS trading adapter is being prepared. Tracking and market access are live.',
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
