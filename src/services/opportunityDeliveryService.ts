import {
  resolveTokenOpenTarget,
} from '../core/tokenOpenRouter.js';

import {
  scanRobinhoodDevTokenFlow,
} from '../chains/robinhood/security/devTokenFlowScanner.js';

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

function rawNumber(
  opportunity: OpportunityRow,
  key: string,
): number | null {
  const value =
    opportunity.raw_data?.[key];

  return (
    typeof value === 'number' &&
    Number.isFinite(value)
  )
    ? value
    : null;
}

function devEvidenceLines(
  opportunity: OpportunityRow,
): string[] {
  const holding =
    rawNumber(
      opportunity,
      'devHoldingPercent',
    );

  const burned =
    rawNumber(
      opportunity,
      'totalBurnPercent',
    );

  const devBurn =
    rawNumber(
      opportunity,
      'confirmedDevBurnPercent',
    );

  const transferred =
    rawNumber(
      opportunity,
      'otherDevTransferPercent',
    );

  if (
    holding == null &&
    burned == null &&
    devBurn == null &&
    transferred == null
  ) {
    return [];
  }

  const lines = [
    '',
    '👨‍💻 <b>DEV</b>',
  ];

  if (holding != null) {
    lines.push(
      `Holding     <b>${holding.toFixed(2)}%</b>`,
    );
  }

  if (
    burned != null &&
    burned > 0
  ) {
    lines.push(
      `🔥 Burned    <b>${burned.toFixed(2)}%</b>`,
    );
  }

  if (
    devBurn != null &&
    devBurn > 0
  ) {
    lines.push(
      `🔥 Dev Burn  <b>${devBurn.toFixed(2)}%</b>`,
    );
  }

  if (
    transferred != null &&
    transferred > 0
  ) {
    lines.push(
      `Transferred <b>${transferred.toFixed(2)}%</b>`,
    );
  }

  return lines;
}

function actionPresentation(
  opportunity: OpportunityRow,
): {
  title: string;
  action: string;
  riskLabel: string;
} {
  const action =
    String(
      opportunity.recommended_action ??
      '',
    ).toUpperCase();

  const risk =
    Number(
      opportunity.risk_score ??
      50,
    );

  const riskLabel =
    risk >= 80
      ? 'HIGH'
      : risk >= 55
        ? 'MEDIUM'
        : 'LOW';

  if (action === 'EXIT') {
    return {
      title:
        '🔴 ALPHAOS · EXIT / AVOID',
      action:
        'Protect capital · review now',
      riskLabel,
    };
  }

  if (action === 'BUY') {
    return {
      title:
        '🔥 ALPHAOS · BUY SETUP',
      action:
        'Qualified setup detected',
      riskLabel,
    };
  }

  return {
    title:
      '🔥 ALPHAOS · ENTRY READY',
    action:
      'Entry window detected',
    riskLabel,
  };
}

function strategyLabel(
  opportunity: OpportunityRow,
): string {
  const strategy =
    String(
      opportunity.strategy_key ??
      'OPPORTUNITY',
    );

  return strategy
    .replace(
      /^PONS_/,
      '',
    )
    .replace(
      /^SOL_/,
      '',
    )
    .replace(
      /_/g,
      ' ',
    );
}

function signedPercent(
  value: number | null,
): string {
  if (value == null) {
    return '-';
  }

  return `${
    value >= 0
      ? '+'
      : ''
  }${value.toFixed(2)}%`;
}

function buildOpportunityMessage(
  opportunity: OpportunityRow,
): string {
  const presentation =
    actionPresentation(
      opportunity,
    );

  const currentRoi =
    rawNumber(
      opportunity,
      'currentRoi',
    );

  const roiChange =
    rawNumber(
      opportunity,
      'roiChange',
    );

  const elapsedSec =
    rawNumber(
      opportunity,
      'elapsedSec',
    );

  const confidence =
    opportunity.confidence == null
      ? '-'
      : `${Math.round(
          opportunity.confidence,
        )}`;

  const age =
    elapsedSec == null
      ? '-'
      : elapsedSec < 60
        ? `${Math.round(
            elapsedSec,
          )}s`
        : `${Math.round(
            elapsedSec /
            60,
          )}m`;

  const reason =
    opportunity.why ??
    opportunity.what_happened ??
    'AlphaOS detected a qualified market-state change.';

  return [
    `<b>${presentation.title}</b>`,
    '',
    `<b>${escapeHtml(
      strategyLabel(
        opportunity,
      ),
    )}</b> · ${escapeHtml(
      age,
    )}`,
    '',
    `Move        <b>${escapeHtml(
      signedPercent(
        currentRoi,
      ),
    )}</b>`,
    `Momentum    <b>${escapeHtml(
      signedPercent(
        roiChange,
      ),
    )}</b>`,
    `Confidence  <b>${escapeHtml(
      confidence,
    )}</b>`,
    `Risk        <b>${escapeHtml(
      presentation.riskLabel,
    )}</b>`,
    ...devEvidenceLines(
      opportunity,
    ),
    '',
    `🧠 ${escapeHtml(
      reason,
    )}`,
    '',
    `<b>${escapeHtml(
      presentation.action,
    )}</b>`,
    '',
    `<code>${escapeHtml(
      compactAddress(
        opportunity.asset_id,
      ),
    )}</code>`,
  ].join(
    '\n',
  );
}

function executionAvailable(
  opportunity: OpportunityRow,
): boolean {
  /*
   * Current real execution adapter:
   * Solana -> Jupiter admin trading.
   *
   * Robinhood/PONS execution must NOT pass through
   * the Solana adapter.
   */
  return (
    String(
      opportunity.chain ??
      '',
    ).toLowerCase() ===
    'solana'
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
  const rows:
    InlineButton[][] = [];

  if (
    executionAvailable(
      opportunity,
    )
  ) {
    rows.push([
      {
        text:
          '⚡ TRADE',

        callback_data:
          `OPP_TRADE_${opportunity.id}`,
      },
    ]);
  }

  rows.push([
    {
      text:
        '👀 TRACK',

      callback_data:
        `OPP_TRACK_${opportunity.id}`,
    },

    {
      text:
        tokenTarget.source ===
        'dexscreener'
          ? '📊 CHART'
          : '🔎 TOKEN',

      url:
        tokenTarget.url,
    },
  ]);

  if (
    opportunity.strategy_key
  ) {
    rows.push([
      {
        text:
          '🔕 MUTE',

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
      'paid',
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


  const tokenTarget =
    await resolveTokenOpenTarget({
      chain:
        opportunity.chain,

      tokenAddress:
        opportunity.asset_id,
    });

  if (
    String(
      opportunity.chain ??
      '',
    ).toLowerCase() ===
    'robinhood'
  ) {
    try {
      const devFlow =
        await scanRobinhoodDevTokenFlow(
          opportunity.asset_id,
        );

      opportunity.raw_data = {
        ...(
          opportunity.raw_data ??
          {}
        ),

        devHoldingPercent:
          devFlow.devHoldingPercent,

        totalBurnPercent:
          devFlow.totalBurnPercent,

        confirmedDevBurnPercent:
          devFlow.confirmedDevBurnPercent,

        otherDevTransferPercent:
          devFlow.otherDevTransferPercent,

        devFlowEvidenceStatus:
          devFlow.evidenceStatus,

        deployerAddress:
          devFlow.deployerAddress,
      };

      console.log(
        '[OpportunityDelivery] Developer flow enriched:',
        {
          opportunityId:
            opportunity.id,

          holding:
            devFlow.devHoldingPercent,

          burned:
            devFlow.totalBurnPercent,

          devBurn:
            devFlow.confirmedDevBurnPercent,

          transferred:
            devFlow.otherDevTransferPercent,

          evidence:
            devFlow.evidenceStatus,
        },
      );
    } catch (error) {
      console.log(
        '[OpportunityDelivery] Developer flow unavailable:',
        error instanceof Error
          ? error.message
          : String(error),
      );
    }
  }

  const users =
    (
      await getDeliverableUsers()
    ).sort(
      (a, b) => {
        const priority = (
          tier: DeliverableUser['tier'],
        ) =>
          tier === 'admin'
            ? 0
            : tier === 'paid'
              ? 1
              : 2;

        return (
          priority(
            a.tier,
          ) -
          priority(
            b.tier,
          )
        );
      },
    );

  /*
   * Admin receives actionable intelligence first.
   *
   * Paid users become eligible 10 seconds after
   * unified delivery begins.
   *
   * This is one shared gate — NOT 10 seconds per
   * subscriber.
   */
  const paidReleaseAt =
    Date.now() +
    10_000;

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

    if (
      user.tier ===
      'paid'
    ) {
      const delayMs =
        Math.max(
          0,
          paidReleaseAt -
          Date.now(),
        );

      if (
        delayMs >
        0
      ) {
        console.log(
          '[OpportunityDelivery] Admin-first release gate:',
          {
            opportunityId:
              opportunity.id,

            telegramId:
              user.telegram_id,

            delayMs,
          },
        );

        await new Promise<void>(
          resolve => {
            setTimeout(
              resolve,
              delayMs,
            );
          },
        );
      }
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
