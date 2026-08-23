import {
  Markup,
  Telegraf,
} from 'telegraf';

import {
  resolveTokenOpenTarget,
} from '../core/tokenOpenRouter.js';

import {
  getLatestOpportunities,
} from '../core/opportunityRegistry.js';

import {
  isOpportunityTracked,
} from '../services/opportunityWatchlistService.js';
import { getContextAccess, requireCapability } from './accessControl.js';
import { hasCapability } from '../product/capabilities.js';
import { strategyDisplay } from '../product/strategyPresentation.js';

type OpportunityRow = {
  id: number | string;
  asset_id: string;
  chain?: string | null;
  strategy_key?: string | null;
  recommended_action?: string | null;
  status?: string | null;
  title?: string | null;
  why?: string | null;
  what_happened?: string | null;
  invalidation?: string | null;
  risk_reason?: string | null;
  confidence?: number | null;
  risk_score?: number | null;
  observation_count?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_observed_at?: string | null;
  expires_at?: string | null;
};

type OpportunityBucket =
  | 'ENTRY'
  | 'BUILDING'
  | 'WATCHING'
  | 'RISK';

function escapeHtml(
  value: unknown,
): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function compactAddress(
  value: string,
): string {
  if (value.length <= 18) {
    return value;
  }

  return (
    value.slice(0, 8) +
    '…' +
    value.slice(-6)
  );
}

function classifyOpportunity(
  opportunity: OpportunityRow,
): OpportunityBucket | null {
  const status =
    String(
      opportunity.status ?? '',
    ).toUpperCase();

  const action =
    String(
      opportunity.recommended_action ?? '',
    ).toUpperCase();

  /*
   * Closed / historical opportunities belong in the
   * Performance Archive, not the live Opportunity Center.
   */
  if (
    status === 'EXECUTED' ||
    status === 'REJECTED' ||
    status === 'EXPIRED' ||
    status === 'REVIEWED'
  ) {
    return null;
  }

  /*
   * Explicit strategy action takes precedence over generic
   * opportunity status.
   *
   * Example:
   * PONS_RISK can legitimately be NEW / WATCH. It belongs in
   * WATCHING, not BUILDING.
   */
  if (action === 'EXIT') {
    return 'RISK';
  }

  if (
    action === 'BUY' ||
    action === 'CHECK_ENTRY'
  ) {
    return 'ENTRY';
  }

  if (action === 'TRACK') {
    return 'BUILDING';
  }

  if (
    action === 'WATCH' ||
    action === 'ADD_TO_WATCHLIST' ||
    action === 'OPEN_TOKEN'
  ) {
    return 'WATCHING';
  }

  if (
    status === 'WATCHING' ||
    status === 'APPROVED'
  ) {
    return 'WATCHING';
  }

  if (status === 'NEW') {
    return 'BUILDING';
  }

  return 'WATCHING';
}

function getBucket(
  opportunities: OpportunityRow[],
  bucket: OpportunityBucket,
): OpportunityRow[] {
  return opportunities.filter(
    (opportunity) =>
      classifyOpportunity(opportunity) === bucket,
  );
}

function relativeTime(
  value?: string | null,
): string {
  if (!value) {
    return 'Unknown';
  }

  const timestamp =
    new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return 'Unknown';
  }

  const seconds =
    Math.max(
      0,
      Math.floor(
        (Date.now() - timestamp) /
          1000,
      ),
    );

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes =
    Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours =
    Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days =
    Math.floor(hours / 24);

  return `${days}d ago`;
}

function bucketMeta(
  bucket: OpportunityBucket,
): {
  title: string;
  description: string;
} {
  switch (bucket) {
    case 'ENTRY':
      return {
        title: '🔥 ENTRY READY',
        description:
          'AlphaOS sees a qualified entry or buy setup.',
      };

    case 'BUILDING':
      return {
        title: '📈 BUILDING',
        description:
          'The thesis is developing but is not entry-ready yet.',
      };

    case 'WATCHING':
      return {
        title: '👀 WATCHING',
        description:
          'Interesting setups being monitored for confirmation.',
      };

    case 'RISK':
      return {
        title: '🚨 RISK / EXIT',
        description:
          'Risk increased or an active thesis may require review.',
      };
  }
}

function opportunityLabel(
  opportunity: OpportunityRow,
): string {
  const title =
    String(
      opportunity.title ??
        compactAddress(
          opportunity.asset_id,
        ),
    );

  const confidence =
    opportunity.confidence == null
      ? ''
      : ` · ${Math.round(
          opportunity.confidence,
        )}%`;

  const trimmed =
    title.length > 28
      ? `${title.slice(0, 27)}…`
      : title;

  return `${trimmed}${confidence}`;
}

function bucketPriority(
  bucket: OpportunityBucket | null,
): number {
  switch (bucket) {
    case 'RISK':
      return 400;

    case 'ENTRY':
      return 300;

    case 'BUILDING':
      return 200;

    case 'WATCHING':
      return 100;

    default:
      return 0;
  }
}

function opportunityRecency(
  opportunity: OpportunityRow,
): number {
  return new Date(
    opportunity.last_observed_at ??
      opportunity.updated_at ??
      opportunity.created_at ??
      0,
  ).getTime();
}

function selectPrimaryLiveTheses(
  opportunities: OpportunityRow[],
): OpportunityRow[] {
  const selected =
    new Map<string, OpportunityRow>();

  for (
    const opportunity
    of opportunities
  ) {
    const key =
      [
        String(
          opportunity.chain ??
            'unknown',
        ).toLowerCase(),

        String(
          opportunity.asset_id,
        ).toLowerCase(),
      ].join(':');

    const existing =
      selected.get(key);

    if (!existing) {
      selected.set(
        key,
        opportunity,
      );

      continue;
    }

    const currentPriority =
      bucketPriority(
        classifyOpportunity(
          opportunity,
        ),
      );

    const existingPriority =
      bucketPriority(
        classifyOpportunity(
          existing,
        ),
      );

    /*
     * User-facing precedence:
     *
     * RISK > ENTRY > BUILDING > WATCHING
     *
     * When two theses have equal priority, display the most
     * recently observed one.
     */
    if (
      currentPriority >
        existingPriority ||
      (
        currentPriority ===
          existingPriority &&
        opportunityRecency(
          opportunity,
        ) >
          opportunityRecency(
            existing,
          )
      )
    ) {
      selected.set(
        key,
        opportunity,
      );
    }
  }

  return [
    ...selected.values(),
  ];
}

async function loadLiveOpportunities():
Promise<OpportunityRow[]> {
  const rows =
    await getLatestOpportunities(50);

  const live =
    (rows as OpportunityRow[])
      .filter(
        (row) =>
          classifyOpportunity(row) !==
          null,
      );

  return selectPrimaryLiveTheses(
    live,
  ).sort(
    (a, b) =>
      opportunityRecency(b) -
      opportunityRecency(a),
  );
}

async function renderScreen(
  ctx: any,
  text: string,
  replyMarkup: any,
) {
  try {
    await ctx.editMessageText(
      text,
      {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      },
    );
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : String(error);

    if (message.toLowerCase().includes('message is not modified')) {
      return;
    }

    await ctx.reply(
      text,
      {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      },
    );
  }
}

async function renderOpportunityHome(
  ctx: any,
) {
  const access = await getContextAccess(ctx);
  const opportunities =
    await loadLiveOpportunities();

  const entry =
    getBucket(
      opportunities,
      'ENTRY',
    );

  const building =
    getBucket(
      opportunities,
      'BUILDING',
    );

  const watching =
    getBucket(
      opportunities,
      'WATCHING',
    );

  const risk =
    getBucket(
      opportunities,
      'RISK',
    );

  const text = [
    '⚡ <b>ALPHAOS OPPORTUNITIES</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '<b>Live strategy intelligence</b>',
    '',
    'AlphaOS continuously observes market conditions and moves opportunities between stages as evidence changes.',
    '',
    `🔥 Entry Ready  <b>${entry.length}</b>`,
    `📈 Building     <b>${building.length}</b>`,
    `👀 Watching     <b>${watching.length}</b>`,
    `🚨 Risk / Exit  <b>${risk.length}</b>`,
    '',
    `Live opportunities: <b>${opportunities.length}</b>`,
    '',
    '<i>Evidence changes continuously. Always verify live market conditions before execution.</i>',
  ].join('\n');

  const homeRows: any[][] = [
      [
        Markup.button.callback(
          hasCapability(access, 'opportunities.realtime')
            ? `🔥 Entry Ready (${entry.length})`
            : '🔒 Entry Ready · Pro',
          'OPP_BUCKET_ENTRY',
        ),
      ],
      [
        Markup.button.callback(
          `📈 Building (${building.length})`,
          'OPP_BUCKET_BUILDING',
        ),
        Markup.button.callback(
          `👀 Watching (${watching.length})`,
          'OPP_BUCKET_WATCHING',
        ),
      ],
      [
        Markup.button.callback(
          `🚨 Risk / Exit (${risk.length})`,
          'OPP_BUCKET_RISK',
        ),
      ],
      [
        Markup.button.callback(
          '🔄 Refresh',
          'OPPORTUNITY_CENTER',
        ),
      ],
      ...(hasCapability(access, 'watchlist.use') ? [[
        Markup.button.callback(
          '👀 My Watchlist',
          'OPP_WATCHLIST',
        ),
      ]] : []),
      [
        Markup.button.callback(
          '🏠 Home',
          'MAIN_MENU',
        ),
      ],
    ];

  const keyboard = Markup.inlineKeyboard(homeRows).reply_markup;

  await renderScreen(
    ctx,
    text,
    keyboard,
  );
}

async function renderBucket(
  ctx: any,
  bucket: OpportunityBucket,
) {
  const opportunities =
    getBucket(
      await loadLiveOpportunities(),
      bucket,
    );

  const meta =
    bucketMeta(bucket);

  const lines = [
    `<b>${meta.title}</b>`,
    '━━━━━━━━━━━━━━━━━━━━━━',
    '',
    escapeHtml(
      meta.description,
    ),
    '',
  ];

  if (opportunities.length === 0) {
    lines.push(
      'No live opportunities in this stage right now.',
      '',
      '<i>AlphaOS will move opportunities here automatically when strategy evidence qualifies.</i>',
    );
  } else {
    lines.push(
      `Showing <b>${Math.min(
        opportunities.length,
        8,
      )}</b> of <b>${opportunities.length}</b>`,
      '',
      'Select an opportunity:',
    );
  }

  const rows =
    opportunities
      .slice(0, 8)
      .map(
        (opportunity) => [
          Markup.button.callback(
            opportunityLabel(
              opportunity,
            ),
            `OPP_VIEW_${opportunity.id}`,
          ),
        ],
      );

  rows.push([
    Markup.button.callback(
      '🔄 Refresh',
      `OPP_BUCKET_${bucket}`,
    ),
  ]);

  rows.push([
    Markup.button.callback(
      '⬅️ Opportunities',
      'OPPORTUNITY_CENTER',
    ),
  ]);

  await renderScreen(
    ctx,
    lines.join('\n'),
    Markup.inlineKeyboard(
      rows,
    ).reply_markup,
  );
}

async function renderOpportunity(
  ctx: any,
  id: string,
) {
  const opportunities =
    await getLatestOpportunities(100);

  const opportunity =
    (
      opportunities as OpportunityRow[]
    ).find(
      (row) =>
        String(row.id) ===
        String(id),
    );

  if (!opportunity) {
    await ctx.answerCbQuery(
      'Opportunity no longer available.',
    );

    await renderOpportunityHome(
      ctx,
    );

    return;
  }

  const bucket =
    classifyOpportunity(
      opportunity,
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

  const action =
    String(
      opportunity.recommended_action ??
        'WATCH',
    ).replace(
      /_/g,
      ' ',
    );

  const title =
    opportunity.title ??
    compactAddress(
      opportunity.asset_id,
    );

  const observedAt =
    opportunity.last_observed_at ??
    opportunity.updated_at ??
    opportunity.created_at;

  const strategy = strategyDisplay(opportunity.strategy_key);
  const state = bucketMeta(bucket ?? 'WATCHING').title.replace(/^[^ ]+ /, '');

  const text = [
    '⚡ <b>ALPHAOS · OPPORTUNITY</b>',
    '',
    `<b>${escapeHtml(title)}</b>`,
    `<code>${escapeHtml(
      compactAddress(
        opportunity.asset_id,
      ),
    )}</code>`,
    '',
    `Chain       <b>${escapeHtml(String(opportunity.chain ?? 'Unknown'))}</b>`,
    `State       <b>${escapeHtml(state)}</b>`,
    `Action      <b>${escapeHtml(
      action,
    )}</b>`,
    `Monitor     <b>${escapeHtml(strategy.name)}</b>`,
    `Confidence  <b>${confidence}</b>`,
    `Risk        <b>${risk}</b>`,
    '',
    `🧠 <b>Why AlphaOS cares</b>`,
    escapeHtml(
      opportunity.why ??
        opportunity.what_happened ??
        'AlphaOS detected a strategy-qualified market change.',
    ),
    '',
    `Last seen   <b>${escapeHtml(
      relativeTime(
        observedAt,
      ),
    )}</b>`,
    '',
    '<i>Verify live market conditions before execution.</i>',
  ].join('\n');

  const tokenTarget =
    await resolveTokenOpenTarget({
      chain:
        opportunity.chain,

      tokenAddress:
        opportunity.asset_id,
    });

  const backCallback =
    bucket
      ? `OPP_BUCKET_${bucket}`
      : 'OPPORTUNITY_CENTER';

  const actionRows: any[][] = [];

  const telegramId = String(ctx.from?.id ?? '');
  const access = await getContextAccess(ctx);
  const canWatch = hasCapability(access, 'watchlist.use');
  const tracked = telegramId && canWatch
    ? await isOpportunityTracked({
        telegramId,
        opportunityId: Number(opportunity.id),
      })
    : false;

  if (
    hasCapability(access, 'trading.admin') &&
    String(
      opportunity.chain ??
      '',
    ).toLowerCase() ===
    'solana'
  ) {
    actionRows.push([
      Markup.button.callback(
        '⚡ TRADE',
        `OPP_TRADE_${opportunity.id}`,
      ),
    ]);
  }

  const marketActions = [];
  if (tokenTarget.chartUrl && tokenTarget.chartUrl !== tokenTarget.tokenUrl) {
    marketActions.push(Markup.button.url('📊 Chart', tokenTarget.chartUrl));
  }
  marketActions.push(Markup.button.url('🔎 Token', tokenTarget.tokenUrl));
  actionRows.push(marketActions);

  if (canWatch) {
    actionRows.push([Markup.button.callback(
      tracked ? '✅ Untrack' : '👀 Track',
      tracked
        ? `OPP_UNTRACK_${opportunity.id}`
        : `OPP_TRACK_${opportunity.id}`,
    )]);
  }

  actionRows.push([
    Markup.button.callback(
      '⬅️ Back',
      backCallback,
    ),

    Markup.button.callback(
      '🔄 Refresh',
      `OPP_VIEW_${opportunity.id}`,
    ),
  ]);

  actionRows.push([
    Markup.button.callback(
      '🏠 Home',
      'MAIN_MENU',
    ),
  ]);

  const keyboard =
    Markup.inlineKeyboard(
      actionRows,
    ).reply_markup;

  await renderScreen(
    ctx,
    text,
    keyboard,
  );
}

export function registerOpportunityCenter(
  bot: Telegraf<any>,
) {
  bot.action(
    'OPPORTUNITY_CENTER',
    async (ctx) => {
      await ctx.answerCbQuery();

      await renderOpportunityHome(
        ctx,
      );
    },
  );

  bot.action(
    /^OPP_BUCKET_(ENTRY|BUILDING|WATCHING|RISK)$/,
    async (ctx) => {
      const bucket =
        String(
          ctx.match?.[1] ??
            'WATCHING',
        ) as OpportunityBucket;

      if (
        bucket === 'ENTRY' &&
        !await requireCapability(ctx, 'opportunities.realtime', 'OPPORTUNITY_CENTER')
      ) return;

      await ctx.answerCbQuery();

      await renderBucket(
        ctx,
        bucket,
      );
    },
  );

  bot.action(
    /^OPP_VIEW_(.+)$/,
    async (ctx) => {
      await ctx.answerCbQuery();

      const id =
        String(
          ctx.match?.[1] ??
            '',
        );

      await renderOpportunity(
        ctx,
        id,
      );
    },
  );
}
