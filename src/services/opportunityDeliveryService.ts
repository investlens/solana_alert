import {
  resolveTokenOpenTarget,
} from '../core/tokenOpenRouter.js';

import {
  eventEngine,
} from './eventEngine.js';

import {
  supabase,
} from './supabase.js';

import {
  sendTelegram,
  type InlineButton,
} from './telegram.js';

import {
  isStrategyEnabledForUser,
} from './strategyService.js';

import {
  getDeliverableUsers,
  markTelegramUserBlocked,
  type DeliverableUser,
} from '../core/delivery.js';

type DeliverableAction =
  | 'BUY'
  | 'CHECK_ENTRY'
  | 'EXIT';

type OpportunityRow = {
  id: number;
  asset_id: string;
  chain: string | null;
  strategy_key: string | null;
  recommended_action: string | null;
  status: string;
  title: string | null;
  why: string | null;
  what_happened: string | null;
  invalidation: string | null;
  risk_reason: string | null;
  confidence: number | null;
  risk_score: number | null;
  raw_data: Record<string, unknown> | null;
};

const ACTIONABLE =
  new Set<string>([
    'BUY',
    'CHECK_ENTRY',
    'EXIT',
  ]);

/*
 * PONS_BREAKOUT already has a proven dedicated Telegram
 * broadcaster. Keep it there until unified delivery has been
 * validated in production, otherwise users could receive
 * duplicate ENTRY_WINDOW alerts.
 */
const TEMPORARILY_EXTERNAL_STRATEGIES =
  new Set<string>([
    'PONS_BREAKOUT',
  ]);

function escapeHtml(
  value: unknown,
): string {
  return String(
    value ?? '',
  )
    .replace(
      /&/g,
      '&amp;',
    )
    .replace(
      /</g,
      '&lt;',
    )
    .replace(
      />/g,
      '&gt;',
    )
    .replace(
      /"/g,
      '&quot;',
    );
}

function compactAddress(
  value: string,
): string {
  if (
    value.length <=
    18
  ) {
    return value;
  }

  return (
    value.slice(
      0,
      8,
    ) +
    '…' +
    value.slice(
      -6,
    )
  );
}

function actionMeta(
  action: DeliverableAction,
): {
  heading: string;
  instruction: string;
} {
  if (
    action ===
    'EXIT'
  ) {
    return {
      heading:
        '🚨 ACTION: REVIEW / EXIT',
      instruction:
        'Risk has materially increased. If you hold this token, review the live position immediately and protect capital.',
    };
  }

  if (
    action ===
    'BUY'
  ) {
    return {
      heading:
        '🟢 ACTION: BUY SETUP',
      instruction:
        'AlphaOS identified a qualified setup. Re-check the live token and execute manually only if the thesis remains intact.',
    };
  }

  return {
    heading:
      '🎯 ACTION: CHECK ENTRY',
    instruction:
      'AlphaOS identified an entry window. Verify the live price, liquidity and momentum before taking a manual position.',
  };
}

function buildOpportunityMessage(
  opportunity: OpportunityRow,
): string {
  const action =
    opportunity.recommended_action as
      DeliverableAction;

  const meta =
    actionMeta(
      action,
    );

  const confidence =
    opportunity.confidence == null
      ? 'Tracking'
      : `${Math.round(
          opportunity.confidence,
        )}/100`;

  const risk =
    opportunity.risk_score == null
      ? 'Tracking'
      : `${Math.round(
          opportunity.risk_score,
        )}/100`;

  return [
    '⚡ <b>ALPHAOS · STRATEGY INTELLIGENCE</b>',
    '',
    `<b>${escapeHtml(
      opportunity.title ??
      compactAddress(
        opportunity.asset_id,
      ),
    )}</b>`,
    `<code>${escapeHtml(
      compactAddress(
        opportunity.asset_id,
      ),
    )}</code>`,
    '',
    `<b>${meta.heading}</b>`,
    meta.instruction,
    '',
    `🧠 <b>STRATEGY</b>`,
    escapeHtml(
      opportunity.strategy_key ??
      'UNKNOWN',
    ),
    '',
    `❓ <b>WHY YOU RECEIVED THIS</b>`,
    escapeHtml(
      opportunity.why ??
      'AlphaOS detected a strategy-qualified change.',
    ),
    '',
    `📈 <b>WHAT HAPPENED</b>`,
    escapeHtml(
      opportunity.what_happened ??
      'A material market-state change was detected.',
    ),
    '',
    `🎯 <b>WHAT TO DO</b>`,
    escapeHtml(
      action.replace(
        /_/g,
        ' ',
      ),
    ),
    '',
    `🛑 <b>INVALIDATION</b>`,
    escapeHtml(
      opportunity.invalidation ??
      'Exit or ignore the setup if the qualifying conditions no longer hold.',
    ),
    '',
    `⚠️ <b>RISK</b>`,
    escapeHtml(
      opportunity.risk_reason ??
      'Crypto markets can reverse quickly.',
    ),
    '',
    `Confidence  <b>${confidence}</b>`,
    `Risk Score  <b>${risk}</b>`,
    '',
    'Manual execution only · verify live market conditions before acting.',
  ].join(
    '\n',
  );
}

function buildButtons(
  opportunity: OpportunityRow,
  tokenTarget: Awaited<
    ReturnType<
      typeof resolveTokenOpenTarget
    >
  >,
): InlineButton[][] {
  const rows: InlineButton[][] = [
    [
      {
        text:
          opportunity.recommended_action ===
          'EXIT'
            ? `🚨 ${tokenTarget.label.replace(
                /^[^A-Z]*/i,
                '',
              )}`
            : tokenTarget.label,
        url:
          tokenTarget.url,
      },
    ],
  ];

  if (
    opportunity.strategy_key
  ) {
    rows.push([
      {
        text:
          '🔕 MUTE STRATEGY',
        callback_data:
          `STRAT_TOGGLE_${opportunity.strategy_key}`,
      },
    ]);
  }

  return rows;
}

function userCanReceiveOpportunity(
  user: DeliverableUser,
): boolean {
  /*
   * Safe rollout:
   *
   * admin_only = default during Phase 2 validation.
   * paid       = admins + active paid subscribers.
   *
   * We deliberately require an explicit environment change
   * before the new unified opportunity format reaches users.
   */
  const mode =
    String(
      process.env.OPPORTUNITY_DELIVERY_MODE ??
      'admin_only',
    )
      .trim()
      .toLowerCase();

  if (
    user.tier ===
    'admin'
  ) {
    return true;
  }

  if (
    mode !==
    'paid'
  ) {
    return false;
  }

  return (
    user.tier ===
      'paid' &&
    user.subscription_status ===
      'active'
  );
}

async function loadOpportunity(
  opportunityId: number,
): Promise<OpportunityRow | null> {
  const {
    data,
    error,
  } =
    await supabase
      .from(
        'opportunities',
      )
      .select(`
        id,
        asset_id,
        chain,
        strategy_key,
        recommended_action,
        status,
        title,
        why,
        what_happened,
        invalidation,
        risk_reason,
        confidence,
        risk_score,
        raw_data
      `)
      .eq(
        'id',
        opportunityId,
      )
      .maybeSingle();

  if (error) {
    throw error;
  }

  return (
    data as OpportunityRow |
      null
  );
}

/*
 * Reserve before sending.
 *
 * The UNIQUE constraint on
 * opportunity_id + telegram_id + delivery_channel
 * makes this safe across process restarts and protects against
 * duplicate subscriber execution.
 *
 * If Telegram fails we remove the reservation so a future event
 * can retry.
 */
async function reserveDelivery(args: {
  opportunity: OpportunityRow;
  user: DeliverableUser;
}): Promise<boolean> {
  const {
    error,
  } =
    await supabase
      .from(
        'opportunity_deliveries',
      )
      .insert({
        opportunity_id:
          args.opportunity.id,

        telegram_id:
          args.user.telegram_id,

        strategy_key:
          args.opportunity.strategy_key,

        chain:
          args.opportunity.chain,

        recommended_action:
          args.opportunity.recommended_action,

        tier_at_delivery:
          args.user.tier,

        delivery_channel:
          'telegram',

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

async function releaseDelivery(
  opportunityId: number,
  telegramId: string,
): Promise<void> {
  await supabase
    .from(
      'opportunity_deliveries',
    )
    .delete()
    .eq(
      'opportunity_id',
      opportunityId,
    )
    .eq(
      'telegram_id',
      telegramId,
    )
    .eq(
      'delivery_channel',
      'telegram',
    );
}

async function markDeliveryComplete(
  opportunityId: number,
  telegramId: string,
): Promise<void> {
  const {
    error,
  } =
    await supabase
      .from(
        'opportunity_deliveries',
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
        'opportunity_id',
        opportunityId,
      )
      .eq(
        'telegram_id',
        telegramId,
      )
      .eq(
        'delivery_channel',
        'telegram',
      );

  if (error) {
    console.warn(
      '[OpportunityDelivery] Delivery completion update failed:',
      {
        opportunityId,
        telegramId,
        error:
          error.message,
      },
    );
  }
}

async function deliverOpportunity(
  opportunityId: number,
): Promise<void> {
  const opportunity =
    await loadOpportunity(
      opportunityId,
    );

  if (!opportunity) {
    return;
  }

  if (
    opportunity.status !==
    'NEW'
  ) {
    return;
  }

  const action =
    String(
      opportunity.recommended_action ??
      '',
    ).toUpperCase();

  if (
    !ACTIONABLE.has(
      action,
    )
  ) {
    return;
  }

  if (
    !opportunity.strategy_key
  ) {
    return;
  }

  if (
    TEMPORARILY_EXTERNAL_STRATEGIES.has(
      opportunity.strategy_key,
    )
  ) {
    console.log(
      '[OpportunityDelivery] Existing external delivery retained:',
      {
        opportunityId:
          opportunity.id,

        strategy:
          opportunity.strategy_key,
      },
    );

    return;
  }

  const tokenTarget =
    await resolveTokenOpenTarget({
      chain:
        opportunity.chain,

      tokenAddress:
        opportunity.asset_id,
    });

  const users =
    await getDeliverableUsers();

  let delivered =
    0;

  for (
    const user of users
  ) {
    if (
      !userCanReceiveOpportunity(
        user,
      )
    ) {
      continue;
    }

    let strategyEnabled =
      false;

    try {
      strategyEnabled =
        await isStrategyEnabledForUser(
          user.telegram_id,
          opportunity.strategy_key,
        );
    } catch (error) {
      console.warn(
        '[OpportunityDelivery] Strategy preference check failed:',
        {
          telegramId:
            user.telegram_id,

          strategy:
            opportunity.strategy_key,

          error:
            error instanceof Error
              ? error.message
              : String(
                  error,
                ),
        },
      );

      continue;
    }

    if (
      !strategyEnabled
    ) {
      continue;
    }

    const reserved =
      await reserveDelivery({
        opportunity,
        user,
      });

    if (!reserved) {
      continue;
    }

    try {
      await sendTelegram(
        user.telegram_id,
        buildOpportunityMessage(
          opportunity,
        ),
        buildButtons(
          opportunity,
          tokenTarget,
        ),
      );

      await markDeliveryComplete(
        opportunity.id,
        user.telegram_id,
      );

      delivered +=
        1;
    } catch (error) {
      await releaseDelivery(
        opportunity.id,
        user.telegram_id,
      );

      const message =
        error instanceof Error
          ? error.message
          : String(
              error,
            );

      if (
        message.includes(
          '403',
        )
      ) {
        await markTelegramUserBlocked(
          user.telegram_id,
        );
      }

      console.error(
        '[OpportunityDelivery] Telegram delivery failed:',
        {
          opportunityId:
            opportunity.id,

          telegramId:
            user.telegram_id,

          strategy:
            opportunity.strategy_key,

          error:
            message,
        },
      );
    }
  }

  console.log(
    '[OpportunityDelivery] Complete:',
    {
      opportunityId:
        opportunity.id,

      token:
        opportunity.asset_id,

      strategy:
        opportunity.strategy_key,

      action,

      delivered,
    },
  );
}

let started =
  false;

export function startOpportunityDeliveryService():
  void {
  if (started) {
    return;
  }

  started =
    true;

  eventEngine.subscribe(
    'OPPORTUNITY_ACTIONABLE',
    async event => {
      const rawId =
        event.payload?.opportunityId;

      const opportunityId =
        Number(
          rawId,
        );

      if (
        !Number.isInteger(
          opportunityId,
        ) ||
        opportunityId <= 0
      ) {
        return;
      }

      await deliverOpportunity(
        opportunityId,
      );
    },
  );

  console.log(
    '[OpportunityDelivery] Started.',
  );
}
