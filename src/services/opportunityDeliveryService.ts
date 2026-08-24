import {
  resolveTokenOpenTarget,
} from '../core/tokenOpenRouter.js';

import {
  scanRobinhoodDevTokenFlow,
} from '../chains/robinhood/security/devTokenFlowScanner.js';
import {
  getSolanaCoreMarketIntelligence,
  mergeSolanaCoreMarketIntelligence,
} from '../chains/solana/coreMarketIntelligence.js';

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

import {
  opportunityDeliveryIdentity,
} from './opportunityDeliveryIdentity.js';
import { accessProfileForUser, hasCapability } from '../product/capabilities.js';
import {
  assertAlphaActions,
  compactAlphaAddress,
  renderAlphaNotification,
  type AlphaNotificationState,
} from '../ui/alphaNotification.js';
import { deliverReservedTelegram } from './telegramDeliveryContract.js';
import { createLeaseToken, DELIVERY_LEASE_SECONDS } from './reservationLease.js';
import { coreDecisionEvidenceMetrics, marketContextMetrics, normalizeCoreDecisionMetrics, normalizeNotificationMarketContext, verifiedPonsPreIndexValuation, type NotificationMarketContext } from '../ui/notificationMarketContext.js';
import { resolvePonsDeliveryContext } from './ponsDeliveryContext.js';
import { persistAlphaAlertEvent } from './alphaAlertLedger.js';
import { criticalAvoidReason, shouldDeliverExit, userHasExitRelevance } from './alphaExitRelevance.js';

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

export function buildOpportunityMessage(
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

  const action = String(opportunity.recommended_action ?? '').toUpperCase();
  const state: AlphaNotificationState = action === 'EXIT'
    ? 'EXIT_AVOID'
    : action === 'BUY' || action === 'CHECK_ENTRY'
      ? 'ENTRY_READY'
      : action === 'TRACK'
        ? 'BUILDING'
        : 'WATCHING';
  const transferred = rawNumber(opportunity, 'otherDevTransferPercent');
  const transferEvidenceComplete = opportunity.raw_data?.devFlowEvidenceStatus === 'COMPLETE';
  const transferZeroMeaningful = opportunity.raw_data?.transferZeroConfirmedMeaningful === true;
  const decisionEvidence = normalizeCoreDecisionMetrics(opportunity.raw_data);
  const market = normalizeNotificationMarketContext(
    opportunity.raw_data,
    opportunity.raw_data?.market as Record<string, unknown> | undefined,
    opportunity.raw_data?.intelligence as Record<string, unknown> | undefined,
    { address: opportunity.asset_id },
  );
  const symbol = market.symbol;
  const hasPreIndexValuation = market.preIndexValuation != null;
  const earlyMarketIndexing = (
    ['robinhood', 'pons'].includes(String(opportunity.chain ?? '').toLowerCase()) &&
    String(opportunity.strategy_key ?? '').toUpperCase().startsWith('PONS_') &&
    (action === 'BUY' || action === 'CHECK_ENTRY') &&
    elapsedSec != null && elapsedSec >= 0 && elapsedSec <= 600 &&
    Boolean(market.symbol || market.name) &&
    market.marketCap == null && market.fdv == null && market.liquidity == null && !market.chartUrl &&
    !hasPreIndexValuation &&
    opportunity.raw_data?.marketIndexState === 'NOT_INDEXED'
  );

  return renderAlphaNotification({
    category: action === 'EXIT' ? 'risk' : 'opportunity',
    severity: action === 'EXIT' ? 'critical' : action === 'BUY' ? 'positive' : 'watch',
    state,
    title: opportunity.title,
    symbol,
    token: symbol ? undefined : market.name ?? compactAlphaAddress(opportunity.asset_id),
    address: opportunity.asset_id,
    chain: opportunity.chain,
    age,
    confidence: opportunity.confidence,
    risk: presentation.riskLabel,
    metrics: [
      ...marketContextMetrics(market),
      ...(earlyMarketIndexing ? [{ label: 'Market', value: 'INDEXING' }] : []),
      ...(currentRoi == null ? [] : [{ label: 'Move', value: signedPercent(currentRoi) }]),
      ...(roiChange == null ? [] : [{ label: 'Momentum', value: signedPercent(roiChange) }]),
    ],
    specialistMetrics: [
      ...coreDecisionEvidenceMetrics(decisionEvidence),
      ...(transferred == null || (transferred === 0 && (!transferEvidenceComplete || !transferZeroMeaningful))
        ? []
        : [{ label: 'Transferred', value: `${transferred.toFixed(2)}%` }]),
    ],
    reason,
    recommendedAction: earlyMarketIndexing
      ? 'Market data is still indexing.'
      : hasPreIndexValuation
        ? 'Market indexing · valuation from verified launch curve.'
      : presentation.action,
  });
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

export function buildButtons(
  opportunity: OpportunityRow,
  tokenTarget: Awaited<
    ReturnType<
      typeof resolveTokenOpenTarget
    >
  >,
  user: DeliverableUser,
): InlineButton[][] {
  const rows:
    InlineButton[][] = [];

  if (
    executionAvailable(opportunity) &&
    hasCapability(accessProfileForUser(user), 'trading.admin')
  ) {
    rows.push([
      {
        text:
          '⚡ Trade',

        callback_data:
          `OPP_TRADE_${opportunity.id}`,
      },
    ]);
  }

  const marketActions: InlineButton[] = [];
  if (tokenTarget.chartUrl && tokenTarget.chartUrl !== tokenTarget.tokenUrl) {
    marketActions.push({ text: '📊 Chart', url: tokenTarget.chartUrl });
  }
  marketActions.push({ text: '🔎 Token', url: tokenTarget.tokenUrl });
  rows.push(marketActions);

  if (/^0x[a-fA-F0-9]{40}$/.test(opportunity.asset_id)) {
    rows.push([{
      text: '📋 Copy CA',
      callback_data: `COPY_CA_${opportunity.asset_id}`,
    }]);
  }

  const preferenceActions: InlineButton[] = [{
    text: '👀 Track',
    callback_data: `OPP_TRACK_${opportunity.id}`,
  }];

  if (
    opportunity.strategy_key &&
    Buffer.byteLength(`STRAT_TOGGLE_${opportunity.strategy_key}`, 'utf8') <= 64
  ) {
    preferenceActions.push({
      text: '🔕 Mute',
      callback_data: `STRAT_TOGGLE_${opportunity.strategy_key}`,
    });
  }
  rows.push(preferenceActions);

  return assertAlphaActions(rows);
}

export function mergeOpportunityMarketContext(
  opportunity: OpportunityRow,
  enrichment: Partial<NotificationMarketContext> | null | undefined,
  marketIndexState?: 'VERIFIED' | 'NOT_INDEXED',
): Record<string, unknown> {
  const existing = opportunity.raw_data ?? {};
  const normalized = normalizeNotificationMarketContext(
    existing,
    existing.market as Record<string, unknown> | undefined,
    enrichment as Record<string, unknown> | undefined,
    { address: opportunity.asset_id },
  );
  const currentMarket = marketIndexState === 'VERIFIED'
    ? normalizeNotificationMarketContext(
        enrichment as Record<string, unknown> | undefined,
        { address: opportunity.asset_id },
      )
    : normalized;
  const observedAt = new Date().toISOString();
  const verifiedMarketContext = marketIndexState === 'VERIFIED'
    ? {
        marketCap: currentMarket.marketCap,
        fdv: currentMarket.fdv,
        liquidity: currentMarket.liquidity,
        volume5m: currentMarket.volume5m,
        chartUrl: currentMarket.chartUrl,
        observedAt,
        source: 'ROBINHOOD_MARKET_SNAPSHOT',
      }
    : existing.verifiedMarketContext;
  const currentMarketFields = marketIndexState === 'VERIFIED'
    ? {
        marketCap: currentMarket.marketCap,
        fdv: currentMarket.fdv,
        liquidity: currentMarket.liquidity,
        volume5m: currentMarket.volume5m,
        chartUrl: currentMarket.chartUrl,
      }
    : {
        ...(currentMarket.marketCap != null ? { marketCap: currentMarket.marketCap } : {}),
        ...(currentMarket.fdv != null ? { fdv: currentMarket.fdv } : {}),
        ...(currentMarket.liquidity != null ? { liquidity: currentMarket.liquidity } : {}),
        ...(currentMarket.volume5m != null ? { volume5m: currentMarket.volume5m } : {}),
        ...(currentMarket.chartUrl ? { chartUrl: currentMarket.chartUrl } : {}),
      };
  return {
    ...existing,
    ...(normalized.symbol ? { symbol: normalized.symbol } : {}),
    ...(normalized.name ? { name: normalized.name } : {}),
    ...currentMarketFields,
    ...(marketIndexState ? { marketIndexState } : {}),
    ...(marketIndexState === 'VERIFIED' && typeof (enrichment as Record<string, unknown> | null | undefined)?.priceUsd === 'number'
      ? {
          priceWhenVerified: (enrichment as Record<string, unknown>).priceUsd,
          priceProvenance: (enrichment as Record<string, unknown>).priceProvenance ?? 'VERIFIED_MARKET_INDEX',
        }
      : {}),
    ...(normalized.symbol || normalized.name
      ? {
          identityVerifiedAt: existing.identityVerifiedAt ?? observedAt,
          identitySource: existing.identitySource ?? (
            marketIndexState === 'VERIFIED' ? 'ROBINHOOD_MARKET_SNAPSHOT' : 'ROBINHOOD_ONCHAIN_METADATA'
          ),
        }
      : {}),
    ...(verifiedMarketContext ? { verifiedMarketContext } : {}),
  };
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

  const access = accessProfileForUser(user);
  if (access.tier === 'admin') return true;
  if (mode !== 'paid') return false;
  return hasCapability(access, 'opportunities.realtime');
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
  deliveryIdentity: string;
}): Promise<string | null> {
  const leaseToken = createLeaseToken();
  const { data, error } = await supabase.rpc('reserve_opportunity_delivery', {
    p_opportunity_id: args.opportunity.id,
    p_telegram_id: args.user.telegram_id,
    p_strategy_key: args.opportunity.strategy_key,
    p_chain: args.opportunity.chain,
    p_recommended_action: args.opportunity.recommended_action,
    p_tier_at_delivery: args.user.tier,
    p_delivery_channel: 'telegram',
    p_delivery_identity: args.deliveryIdentity,
    p_lease_token: leaseToken,
    p_lease_seconds: DELIVERY_LEASE_SECONDS,
  });
  if (error) throw error;
  return data === true ? leaseToken : null;
}

async function releaseDelivery(
  opportunityId: number,
  telegramId: string,
  deliveryIdentity: string,
  leaseToken: string,
): Promise<void> {
  const { error } = await supabase
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
    )
    .eq(
      'delivery_identity',
      deliveryIdentity,
    )
    .contains('metadata', { state: 'RESERVED', lease_token: leaseToken });

  if (error) throw error;
}

async function markDeliveryComplete(
  opportunityId: number,
  telegramId: string,
  deliveryIdentity: string,
  leaseToken: string,
): Promise<void> {
  const {
    data,
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
    )
    .eq(
      'delivery_identity',
      deliveryIdentity,
    )
    .contains('metadata', { state: 'RESERVED', lease_token: leaseToken })
    .select('id')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error('Opportunity delivery lease was lost before completion');
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

  const deliveryIdentity =
    opportunityDeliveryIdentity({
      action,
      status: opportunity.status,
    });

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


  const isPons = ['robinhood', 'pons'].includes(String(opportunity.chain ?? '').toLowerCase()) &&
    String(opportunity.strategy_key ?? '').toUpperCase().startsWith('PONS_');
  const resolvedPons = isPons
    ? await resolvePonsDeliveryContext(opportunity)
    : null;
  if (resolvedPons) opportunity.raw_data = resolvedPons.rawData;
  const tokenTarget = resolvedPons?.target ?? await resolveTokenOpenTarget({
    chain: opportunity.chain,
    tokenAddress: opportunity.asset_id,
  });

  opportunity.raw_data = mergeOpportunityMarketContext(
    opportunity,
    tokenTarget.marketContext,
    tokenTarget.marketIndexState,
  );

  let devEvidenceEnriched = false;
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

        devHoldingEvidence:
          devFlow.devHoldingPercent == null ? 'UNAVAILABLE' : 'VERIFIED',

        devHoldingSource:
          'ROBINHOOD_DEV_TOKEN_FLOW',

        devHoldingObservedAt:
          new Date(devFlow.scannedAt).toISOString(),

        totalBurnPercent:
          devFlow.totalBurnPercent,

        burnEvidence:
          devFlow.totalBurnPercent == null ? 'UNAVAILABLE' : 'VERIFIED',

        burnSource:
          'ROBINHOOD_DEAD_AND_ZERO_BALANCES',

        burnObservedAt:
          new Date(devFlow.scannedAt).toISOString(),

        confirmedDevBurnPercent:
          devFlow.confirmedDevBurnPercent,

        otherDevTransferPercent:
          devFlow.otherDevTransferPercent,

        devFlowEvidenceStatus:
          devFlow.evidenceStatus,

        deployerAddress:
          devFlow.deployerAddress,
      };
      devEvidenceEnriched = devFlow.devHoldingPercent != null || devFlow.totalBurnPercent != null;

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

  if (String(opportunity.chain ?? '').toLowerCase() === 'solana') {
    const existingEvidence = normalizeCoreDecisionMetrics(opportunity.raw_data);
    if (existingEvidence.devHoldingEvidence !== 'VERIFIED') {
      try {
        const solanaEvidence = await getSolanaCoreMarketIntelligence(opportunity.asset_id);
        const enriched = mergeSolanaCoreMarketIntelligence(opportunity.raw_data, solanaEvidence);
        devEvidenceEnriched = enriched.devHoldingEvidence === 'VERIFIED';
        opportunity.raw_data = enriched;
      } catch (error) {
        // Core evidence is optional: alert delivery must remain available.
        console.log(
          '[OpportunityDelivery] Solana core evidence unavailable:',
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  if (tokenTarget.marketContext || devEvidenceEnriched ||
      verifiedPonsPreIndexValuation(opportunity.raw_data, opportunity.asset_id) != null) {
    const { error } = await supabase
      .from('opportunities')
      .update({ raw_data: opportunity.raw_data })
      .eq('id', opportunity.id);
    if (error) {
      console.warn('[OpportunityDelivery] Market enrichment persistence failed', {
        opportunityId: opportunity.id,
        error: error.message,
      });
    }
  }

  // Final normalized context, before user-specific filtering or Telegram retries.
  await persistAlphaAlertEvent(opportunity);
  const criticalReason = action === 'EXIT' ? criticalAvoidReason(opportunity.raw_data) : null;

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

    if (action === 'EXIT') {
      const relevant = await userHasExitRelevance({
        telegramId: user.telegram_id, assetId: opportunity.asset_id,
        chain: opportunity.chain, opportunityId: opportunity.id,
      });
      if (!shouldDeliverExit({ action, relevant, criticalReason })) continue;
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

    const leaseToken =
      await reserveDelivery({
        opportunity,
        user,
        deliveryIdentity,
      });

    if (!leaseToken) {
      continue;
    }

    const delivery = await deliverReservedTelegram({
      send: () => sendTelegram(
        user.telegram_id,
        buildOpportunityMessage(
          opportunity,
        ),
        buildButtons(
          opportunity,
          tokenTarget,
          user,
        ),
      ),
      complete: () => markDeliveryComplete(
        opportunity.id,
        user.telegram_id,
        deliveryIdentity,
        leaseToken,
      ),
      release: () => releaseDelivery(opportunity.id, user.telegram_id, deliveryIdentity, leaseToken),
    });

    if (delivery.recorded) {
      delivered += 1;
    } else if (delivery.error) {
      const error = delivery.error;
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
        delivery.sent
          ? '[OpportunityDelivery] Delivery accounting failed after Telegram send:'
          : '[OpportunityDelivery] Telegram delivery failed:',
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
