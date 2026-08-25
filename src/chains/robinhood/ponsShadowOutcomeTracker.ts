import {
  supabase,
} from '../../services/supabase.js';

import {
  getRobinhoodMarketSnapshot,
} from './market.js';

import {
  scanRobinhoodDevHolding,
} from './security/devHoldingScanner.js';


import {
  classifyPonsAlpha,
} from './ponsAlphaClassifier.js';


import {
  broadcastPonsAlphaAlert,
} from './ponsAlphaTelegram.js';

import {
  transitionActiveStrategyOpportunity,
} from '../../core/opportunityRegistry.js';

import {
  recordOpportunityAndEmit,
} from '../../services/opportunityService.js';
import { persistAlphaSemanticEvent } from '../../services/alphaSemanticEventService.js';
import { buildAlphaMarketActions } from '../../ui/alphaNotificationActions.js';
import { hasVerifiedOpportunityIdentity, mergePonsLifecycleContext } from '../../product/opportunityContext.js';
import { resolvePonsDeliveryContext } from '../../services/ponsDeliveryContext.js';
import {
  normalizeCoreDecisionMetrics,
  normalizeNotificationMarketContext,
} from '../../ui/notificationMarketContext.js';
import {
  assessTokenIntelligence,
  DEFAULT_SUSTAINED_INTELLIGENCE_CONFIG,
  type IntelligenceObservation,
} from '../../intelligence/tokenIntelligenceState.js';
import { renderPonsPremiumIntelligence } from '../../ui/ponsPremiumIntelligence.js';
import { evaluateRobinhoodCreatorRisk, type RobinhoodCreatorRiskResult } from './robinhoodCreatorRisk.js';

import {
  getPonsV2CurveState,
  quotePonsV2Sell,
} from './ponsV2CurveQuote.js';
import {
  resolvePonsV2PreIndexValuation,
  type VerifiedPonsPreIndexValuation,
} from './ponsPreIndexValuation.js';



function ponsConfidence(
  value: number,
): number {
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(value),
    ),
  );
}

export function ponsIntelligenceState(state: string) {
  switch (state) {
    case 'MOMENTUM_BUILDING': return 'BUILDING' as const;
    case 'ENTRY_WINDOW': return 'CONFIRMED' as const;
    case 'FAST_BREAKOUT': return 'CONFIRMED' as const;
    case 'DO_NOT_CHASE': return 'COOLING' as const;
    case 'FADING': return 'WEAKENING' as const;
    case 'FLAT_DEAD': return 'DANGER' as const;
    case 'WATCHING': return 'FORMING' as const;
    default: return 'DISCOVERED' as const;
  }
}

type PonsOpportunitySyncArgs = {
  token: string;
  symbol?: string | null;
  name?: string | null;
  marketCap?: number | null;
  liquidity?: number | null;
  volume5m?: number | null;
  chartUrl?: string | null;
  devHoldingPercent?: number | null;
  preIndexValuation?: VerifiedPonsPreIndexValuation | null;
  creatorRisk?: RobinhoodCreatorRiskResult | null;
  state: string;
  reason: string;
  currentRoi: number;
  roiChange: number | null;
  recentPeakRoi: number | null;
  elapsedSec: number;
};

export function buildPonsOpportunityRawData(args: PonsOpportunitySyncArgs) {
  return {
    symbol: args.symbol ?? null,
    name: args.name ?? null,
    marketCap: args.marketCap ?? null,
    liquidity: args.liquidity ?? null,
    volume5m: args.volume5m ?? null,
    chartUrl: args.chartUrl ?? null,
    devHoldingPercent: args.devHoldingPercent ?? null,
    devHoldingEvidence: args.devHoldingPercent == null ? 'UNAVAILABLE' : 'VERIFIED',
    devHoldingSource: args.devHoldingPercent == null ? null : 'PONS_SHADOW_DEV_HOLDING',
    preIndexValuation: args.preIndexValuation ?? null,
    creatorEvidence: args.creatorRisk ? {
      creatorWallet: args.creatorRisk.creatorWallet, launches: args.creatorRisk.launches,
      severeCrashes: args.creatorRisk.severeCrashes, catastrophicCrashes: args.creatorRisk.catastrophicCrashes,
      status: args.creatorRisk.status, historyPenalty: args.creatorRisk.historyPenalty,
      negativeHistoryEvidence: args.creatorRisk.negativeHistoryEvidence,
    } : null,
    ponsAlphaState:
      args.state,

    intelligenceState:
      ponsIntelligenceState(args.state),

    currentRoi:
      args.currentRoi,

    roiChange:
      args.roiChange,

    recentPeakRoi:
      args.recentPeakRoi,

    elapsedSec:
      args.elapsedSec,

    source:
      'PONS_ALPHA_CLASSIFIER',
  };
}

export async function syncPonsOpportunity(
  args: PonsOpportunitySyncArgs,
): Promise<void> {
  const incomingRawData = buildPonsOpportunityRawData(args);
  const { data: priorRows, error: priorContextError } = await supabase
    .from('opportunities')
    .select('raw_data')
    .eq('asset_id', args.token)
    .eq('chain', 'robinhood')
    .order('updated_at', { ascending: false })
    .limit(20);
  if (priorContextError) {
    console.warn('[PonsAlpha] Prior opportunity context lookup failed:', {
      token: args.token,
      error: priorContextError.message,
    });
  }
  const priorContext = (priorRows ?? [])
    .map(row => row.raw_data as Record<string, unknown> | null)
    .find(hasVerifiedOpportunityIdentity);
  const rawData = mergePonsLifecycleContext(priorContext, incomingRawData);

  /*
   * PONS IGNITION
   *
   * Constructive momentum, but entry is
   * not confirmed yet.
   */
  if (
    args.state ===
    'MOMENTUM_BUILDING'
  ) {
    /*
     * A new constructive setup supersedes any previous
     * PONS risk thesis for this token.
     */
    await transitionActiveStrategyOpportunity({
      assetId:
        args.token,

      chain:
        'robinhood',

      strategyKey:
        'PONS_RISK',

      status:
        'REVIEWED',

      recommendedAction:
        'IGNORE',

      why:
        args.reason,

      whatHappened:
        'A new constructive PONS momentum setup formed after the previous risk state.',

      invalidation:
        'The previous risk thesis has been superseded by a new independent setup.',

      riskReason:
        'Previous PONS risk conditions are no longer the primary active thesis.',

      confidence:
        55,

      riskScore:
        45,

      rawData: {
        ...rawData,
        transition:
          'PONS_RISK_TO_NEW_SETUP',
      },
    });

    await recordOpportunityAndEmit({
      opportunityType:
        'DEX_CONFIRMATION',

      assetId:
        args.token,

      chain:
        'robinhood',

      sourceAgent:
        'PonsAlphaClassifier',

      title:
        `PONS Ignition: ${args.token}`,

      strategyKey:
        'PONS_IGNITION',

      recommendedAction:
        'TRACK',

      why:
        args.reason,

      whatHappened:
        `PONS curve momentum is building. Current ROI is ${args.currentRoi.toFixed(
          2,
        )}%.`,

      invalidation:
        'Invalidate if momentum fades, the setup becomes flat/dead, or the classifier enters a risk state.',

      riskReason:
        'Momentum is constructive but AlphaOS does not yet have confirmed entry acceleration.',

      confidence:
        ponsConfidence(
          Math.max(
            50,
            Math.min(
              75,
              55 +
                Math.max(
                  0,
                  args.currentRoi,
                ),
            ),
          ) - (args.creatorRisk?.historyPenalty ?? 0),
        ),

      riskScore:
        50,

      rawData,
    });

    return;
  }

  /*
   * PONS BREAKOUT
   *
   * ENTRY_WINDOW is the strongest manual
   * entry-confirmation state.
   */
  if (
    args.state ===
    'ENTRY_WINDOW'
  ) {
    await transitionActiveStrategyOpportunity({
      assetId:
        args.token,

      chain:
        'robinhood',

      strategyKey:
        'PONS_IGNITION',

      status:
        'REVIEWED',

      recommendedAction:
        'TRACK',

      why:
        args.reason,

      whatHappened:
        'PONS ignition matured into a confirmed breakout/entry-window setup.',

      invalidation:
        'The ignition phase has completed and is superseded by PONS_BREAKOUT.',

      riskReason:
        'The token has progressed beyond early ignition into a separate breakout thesis.',

      confidence:
        75,

      riskScore:
        40,

      rawData: {
        ...rawData,
        transition:
          'PONS_IGNITION_TO_PONS_BREAKOUT',
      },
    });

    await recordOpportunityAndEmit({
      opportunityType:
        'DEX_CONFIRMATION',

      assetId:
        args.token,

      chain:
        'robinhood',

      sourceAgent:
        'PonsAlphaClassifier',

      title:
        `PONS Breakout: ${args.token}`,

      strategyKey:
        'PONS_BREAKOUT',

      recommendedAction:
        'CHECK_ENTRY',

      why:
        args.reason,

      whatHappened:
        `Confirmed PONS acceleration detected. Current ROI is ${args.currentRoi.toFixed(
          2,
        )}%${
          args.roiChange == null
            ? '.'
            : ` with ${args.roiChange >= 0 ? '+' : ''}${args.roiChange.toFixed(
                2,
              )}% checkpoint acceleration.`
        }`,

      invalidation:
        'Do not enter if the live move has already extended, momentum reverses, or PONS changes to FADING, DO_NOT_CHASE, or FLAT_DEAD.',

      riskReason:
        'PONS launches move extremely quickly. Entry must still be verified against the live curve before execution.',

      confidence:
        ponsConfidence(
          Math.max(
            70,
            Math.min(
              92,
              72 +
                Math.max(
                  0,
                  args.roiChange ??
                    0,
                ),
            ),
          ) - (args.creatorRisk?.historyPenalty ?? 0),
        ),

      riskScore:
        40,

      rawData,
    });

    return;
  }

  /*
   * FAST_BREAKOUT
   *
   * Important: this is deliberately NOT
   * converted into CHECK_ENTRY.
   *
   * Existing AlphaOS behaviour says verify
   * the token but do not chase an extended
   * move.
   */
  if (
    args.state ===
    'FAST_BREAKOUT'
  ) {
    await transitionActiveStrategyOpportunity({
      assetId:
        args.token,

      chain:
        'robinhood',

      strategyKey:
        'PONS_IGNITION',

      status:
        'REVIEWED',

      recommendedAction:
        'TRACK',

      why:
        args.reason,

      whatHappened:
        'PONS ignition matured into a fast-breakout setup.',

      invalidation:
        'The ignition phase has completed and is superseded by PONS_BREAKOUT.',

      riskReason:
        'The token has accelerated beyond the early ignition state.',

      confidence:
        75,

      riskScore:
        55,

      rawData: {
        ...rawData,
        transition:
          'PONS_IGNITION_TO_FAST_BREAKOUT',
      },
    });

    await recordOpportunityAndEmit({
      opportunityType:
        'DEX_CONFIRMATION',

      assetId:
        args.token,

      chain:
        'robinhood',

      sourceAgent:
        'PonsAlphaClassifier',

      title:
        `PONS Fast Breakout: ${args.token}`,

      strategyKey:
        'PONS_BREAKOUT',

      recommendedAction:
        'TRACK',

      why:
        args.reason,

      whatHappened:
        `A fast PONS breakout is underway at ${args.currentRoi.toFixed(
          2,
        )}% ROI.`,

      invalidation:
        'Do not chase if price remains extended. Wait for a safer setup or fresh confirmation.',

      riskReason:
        'The move is strong but may already be too extended for a safe entry.',

      confidence:
        78,

      riskScore:
        65,

      rawData,
    });

    return;
  }

  /*
   * RISK / INVALIDATION
   */
  if (
    args.state ===
      'FADING' ||
    args.state ===
      'DO_NOT_CHASE'
  ) {
    const action =
      args.state ===
      'FADING'
        ? 'EXIT'
        : 'WATCH';

    /*
     * First invalidate any active breakout
     * thesis.
     */
    await transitionActiveStrategyOpportunity({
      assetId:
        args.token,

      chain:
        'robinhood',

      strategyKey:
        'PONS_BREAKOUT',

      status:
        'EXPIRED',

      recommendedAction:
        'IGNORE',

      why:
        args.reason,

      whatHappened:
        `PONS state changed to ${args.state}. Current ROI is ${args.currentRoi.toFixed(
          2,
        )}%.`,

      invalidation:
        'The previous breakout thesis is no longer valid.',

      riskReason:
        args.reason,

      confidence:
        40,

      riskScore:
        85,

      rawData,
    });

    /*
     * Also close an ignition thesis if one
     * is still active.
     */
    await transitionActiveStrategyOpportunity({
      assetId:
        args.token,

      chain:
        'robinhood',

      strategyKey:
        'PONS_IGNITION',

      status:
        'EXPIRED',

      recommendedAction:
        'IGNORE',

      why:
        args.reason,

      whatHappened:
        `PONS momentum deteriorated into ${args.state}.`,

      invalidation:
        'The previous ignition thesis is no longer valid.',

      riskReason:
        args.reason,

      confidence:
        35,

      riskScore:
        85,

      rawData,
    });

    await recordOpportunityAndEmit({
      opportunityType:
        'DEX_CONFIRMATION',

      assetId:
        args.token,

      chain:
        'robinhood',

      sourceAgent:
        'PonsAlphaClassifier',

      title:
        `PONS Risk: ${args.token}`,

      strategyKey:
        'PONS_RISK',

      recommendedAction:
        action,

      why:
        args.reason,

      whatHappened:
        `PONS classified the live curve as ${args.state}. Current ROI is ${args.currentRoi.toFixed(
          2,
        )}%.`,

      invalidation:
        'Risk remains active until a new independent setup forms.',

      riskReason:
        args.reason,

      confidence:
        80,

      riskScore:
        args.state ===
        'FADING'
          ? 90
          : 75,

      rawData,
    });

    return;
  }

  /*
   * DEAD / EXPIRED SETUP
   *
   * Close active opportunity theses without
   * creating another noisy user opportunity.
   */
  if (
    args.state ===
    'FLAT_DEAD'
  ) {
    for (
      const strategyKey
      of [
        'PONS_IGNITION',
        'PONS_BREAKOUT',
        'PONS_RISK',
      ]
    ) {
      await transitionActiveStrategyOpportunity({
        assetId:
          args.token,

        chain:
          'robinhood',

        strategyKey,

        status:
          'EXPIRED',

        recommendedAction:
          'IGNORE',

        why:
          args.reason,

        whatHappened:
          `PONS setup expired at ${args.currentRoi.toFixed(
            2,
          )}% ROI.`,

        invalidation:
          'The previous PONS setup is no longer active.',

        riskReason:
          'Momentum failed to develop into a valid continuation setup.',

        confidence:
          30,

        riskScore:
          70,

        rawData,
      });
    }
  }
}

const TRACKER_INTERVAL_MS =
  1_000;


const MAX_ROWS_PER_CYCLE =
  25;


/*
 * We do not want tiny floating-point
 * fluctuations to look like a dev sell.
 *
 * Example:
 * 4.0000% -> 3.9999%
 *
 * should NOT count as a meaningful
 * developer movement.
 */
const DEV_MOVEMENT_EPSILON_PERCENT =
  0.01;


/*
 * Dev checks do not need to fire for
 * every token on every 1-second cycle.
 *
 * Price is still checked every cycle.
 */
const DEV_CHECK_INTERVAL_MS =
  2_000;


type ShadowRow = {
  id: string;

  token_address: string;

  launch_version:
    string | null;

  curve_address:
    string | null;

  shadow_investment_raw:
    string | null;

  shadow_tokens_bought_raw:
    string | null;

  shadow_quote_asset:
    string | null;

  deployer_address:
    string | null;

  detected_at:
    string;

  would_buy_at:
    string | null;

  entry_price:
    number | null;

  entry_market_cap:
    number | null;

  entry_liquidity:
    number | null;

  dev_holding_percent:
    number | null;

  price_5s:
    number | null;

  roi_5s_percent:
    number | null;

  price_10s:
    number | null;

  roi_10s_percent:
    number | null;

  price_30s:
    number | null;

  roi_30s_percent:
    number | null;

  price_1m:
    number | null;

  roi_1m_percent:
    number | null;

  price_2m:
    number | null;

  roi_2m_percent:
    number | null;

  price_5m:
    number | null;

  roi_5m_percent:
    number | null;

  peak_price:
    number | null;

  peak_roi_percent:
    number | null;

  dev_first_movement_at:
    string | null;

  dev_first_movement_roi_percent:
    number | null;

  tp_100_hit:
    boolean | null;

  tp_200_hit:
    boolean | null;

  tp_500_hit:
    boolean | null;

  tp_1000_hit:
    boolean | null;

  tp_100_hit_at:
    string | null;

  tp_200_hit_at:
    string | null;

  tp_500_hit_at:
    string | null;

  tp_1000_hit_at:
    string | null;

  shadow_status:
    string;

  updated_at:
    string | null;

  alpha_state:
    string | null;

  alpha_state_changed_at:
    string | null;

  alpha_entry_alert_sent:
    boolean | null;

  alpha_breakout_alert_sent:
    boolean | null;

  alpha_exit_alert_sent:
    boolean | null;

  intelligence_state:
    string | null;

  intelligence_state_observed_at:
    string | null;
};


type ShadowUpdate =
  Record<
    string,
    unknown
  >;


let trackerStarted =
  false;


let trackerRunning =
  false;


let trackerInterval:
  | ReturnType<typeof setInterval>
  | null =
  null;


/*
 * Keep the latest dev-scan time in memory
 * so the 1-second price tracker does not
 * hammer the dev scanner every second.
 */
const lastDevCheckAt =
  new Map<
    string,
    number
  >();

function calculateRoi(
  entryPrice:
    number,

  currentPrice:
    number,
): number {
  if (
    !Number.isFinite(
      entryPrice,
    ) ||
    entryPrice <= 0 ||
    !Number.isFinite(
      currentPrice,
    ) ||
    currentPrice <= 0
  ) {
    return 0;
  }


  return (
    (
      currentPrice -
      entryPrice
    ) /
    entryPrice
  ) *
    100;
}


function validNumber(
  value:
    unknown,
): value is number {
  return (
    typeof value ===
      'number' &&
    Number.isFinite(
      value,
    )
  );
}

export function nextPonsRuntimeIntelligenceState(args: {
  classifiedState: string; priorState: string | null; priorObservedAt: string | null;
  observedAt: string; currentRoi: number; peakRoi: number | null; confirmedDevMovement: boolean;
}) {
  const normalized = ponsIntelligenceState(args.classifiedState);
  const laterObservation = args.priorObservedAt != null && Date.parse(args.observedAt) > Date.parse(args.priorObservedAt);
  const retention = args.peakRoi != null && args.peakRoi > 0 ? args.currentRoi / args.peakRoi : 0;
  if (args.priorState === 'RUNNER' && normalized === 'CONFIRMED' &&
      args.currentRoi > 0 && retention >= 0.5 && !args.confirmedDevMovement) return 'RUNNER' as const;
  if (args.priorState === 'CONFIRMED' && normalized === 'CONFIRMED' && laterObservation &&
      args.currentRoi > 0 && retention >= 0.5 && !args.confirmedDevMovement) return 'RUNNER' as const;
  return normalized;
}

async function recordPonsRuntimeTransition(args: { row: ShadowRow; classifiedState: string; currentRoi: number; peakRoi: number | null; observedAt: string }) {
  const nextState = nextPonsRuntimeIntelligenceState({ classifiedState: args.classifiedState,
    priorState: args.row.intelligence_state, priorObservedAt: args.row.intelligence_state_observed_at,
    observedAt: args.observedAt, currentRoi: args.currentRoi, peakRoi: args.peakRoi,
    confirmedDevMovement: Boolean(args.row.dev_first_movement_at) });
  const changed = nextState !== args.row.intelligence_state;
  if (changed) {
    let transition = supabase.from('pons_shadow_trades')
      .update({ intelligence_state: nextState, intelligence_state_observed_at: args.observedAt })
      .eq('id', args.row.id);
    transition = args.row.intelligence_state_observed_at == null
      ? transition.is('intelligence_state_observed_at', null)
      : transition.eq('intelligence_state_observed_at', args.row.intelligence_state_observed_at);
    const { data, error } = await transition.select('id').maybeSingle();
    if (error) throw error; if (!data) return;
  } else if (nextState !== 'BUILDING') return;
  if (['DISCOVERED', 'FORMING', 'CONFIRMED'].includes(nextState)) return;
  const type = ['BUILDING', 'RUNNER', 'COOLING', 'WEAKENING', 'DANGER'].includes(nextState)
    ? nextState as 'BUILDING' | 'RUNNER' | 'COOLING' | 'WEAKENING' | 'DANGER' : null;
  if (!type) return;
  if (nextState === 'BUILDING') {
    const gate = assessPonsBuildingGate({ row: args.row, currentRoi: args.currentRoi,
      peakRoi: args.peakRoi, observedAt: args.observedAt });
    if (!gate.sustained || !gate.ageEligible || !gate.positiveRetainedStructure) return;
    const { data: existing } = await supabase.from('alpha_alert_events').select('id')
      .eq('event_identity', `v2:BUILDING:${args.row.id}:BUILDING`).maybeSingle();
    if (existing) return;
  }
  const baseSnapshot: Record<string, unknown> = { currentRoi: args.currentRoi,
    peakRoi: args.peakRoi, classifiedState: args.classifiedState, observedAt: args.observedAt };
  const presentation = ['BUILDING', 'RUNNER'].includes(nextState)
    ? await resolvePonsSustainedPresentation({ row: args.row, state: nextState as 'BUILDING' | 'RUNNER',
        currentRoi: args.currentRoi, peakRoi: args.peakRoi, observedAt: args.observedAt })
    : null;
  if (nextState === 'BUILDING' && !presentation?.eligibleForBuilding) return;
  await persistAlphaSemanticEvent({ identity: `${args.row.id}:${nextState}`,
    type, assetId: args.row.token_address, chain: 'robinhood', intelligenceState: nextState,
    strategyKey: 'PONS_SUSTAINED', symbol: presentation?.snapshot.symbol as string | null | undefined,
    rawSnapshot: presentation?.snapshot ?? baseSnapshot });
}

function checkpointObservation(entryMs: number, seconds: number, roi: number | null): IntelligenceObservation | null {
  return validNumber(roi) ? { roi, observedAt: new Date(entryMs + seconds * 1000).toISOString() } : null;
}

export function assessPonsBuildingGate(args: {
  row: Pick<ShadowRow, 'would_buy_at' | 'detected_at' | 'roi_5s_percent' | 'roi_10s_percent' |
    'roi_30s_percent' | 'roi_1m_percent' | 'roi_2m_percent' | 'roi_5m_percent'>;
  currentRoi: number; peakRoi: number | null; observedAt: string;
}) {
  const entryMs = Date.parse(args.row.would_buy_at ?? args.row.detected_at);
  const observedMs = Date.parse(args.observedAt);
  const checkpoints = [
    checkpointObservation(entryMs, 0, 0), checkpointObservation(entryMs, 5, args.row.roi_5s_percent),
    checkpointObservation(entryMs, 10, args.row.roi_10s_percent), checkpointObservation(entryMs, 30, args.row.roi_30s_percent),
    checkpointObservation(entryMs, 60, args.row.roi_1m_percent), checkpointObservation(entryMs, 120, args.row.roi_2m_percent),
    checkpointObservation(entryMs, 300, args.row.roi_5m_percent),
  ].filter((row): row is IntelligenceObservation => row != null && Date.parse(row.observedAt) <= observedMs);
  checkpoints.push({ roi: args.currentRoi, observedAt: args.observedAt });
  const assessment = assessTokenIntelligence({ observations: checkpoints });
  const elapsedSeconds = Number.isFinite(entryMs) && Number.isFinite(observedMs)
    ? Math.max(0, (observedMs - entryMs) / 1000) : 0;
  const retained = args.peakRoi != null && args.peakRoi > 0 ? args.currentRoi / args.peakRoi : 0;
  return {
    sustained: assessment.sustained,
    elapsedSeconds,
    ageEligible: elapsedSeconds >= DEFAULT_SUSTAINED_INTELLIGENCE_CONFIG.minimumSustainedSeconds,
    positiveRetainedStructure: args.currentRoi > 0 && retained >= DEFAULT_SUSTAINED_INTELLIGENCE_CONFIG.retainedMoveRatio,
  };
}

type SustainedOpportunity = {
  id: number; asset_id: string; chain: string | null; strategy_key: string | null;
  risk_score: number | null; raw_data: Record<string, unknown> | null;
};

function meaningfulTokenName(name: string | null, symbol: string | null, address: string): string | null {
  const clean = String(name ?? '').trim();
  if (!clean || /^unknown(?: token)?$/i.test(clean) || clean.toLowerCase() === address.toLowerCase() ||
      clean.toLowerCase() === String(symbol ?? '').trim().toLowerCase()) return null;
  return clean;
}

function sustainedRiskLabel(opportunity: SustainedOpportunity | null): string | null {
  const explicit = String(opportunity?.raw_data?.riskLabel ?? opportunity?.raw_data?.risk ?? '').toUpperCase();
  if (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'REVIEW'].includes(explicit)) return explicit;
  if (opportunity?.risk_score == null) return null;
  const score = Number(opportunity?.risk_score);
  if (!Number.isFinite(score)) return null;
  return score >= 80 ? 'HIGH' : score >= 55 ? 'MEDIUM' : 'LOW';
}

export function buildPonsSustainedPresentation(args: {
  state: 'BUILDING' | 'RUNNER'; tokenAddress: string; detectedAt: string; currentRoi: number;
  peakRoi: number | null; observedAt: string; opportunity: SustainedOpportunity | null;
  rawData: Record<string, unknown>; target: { tokenUrl: string; chartUrl?: string };
}) {
  const market = normalizeNotificationMarketContext(
    args.target.chartUrl ? { ...args.rawData, chartUrl: args.target.chartUrl, marketIndexState: 'VERIFIED' } : args.rawData,
    { address: args.tokenAddress },
  );
  const evidence = normalizeCoreDecisionMetrics(args.rawData);
  const peakRoi = args.peakRoi == null ? null : Math.max(args.currentRoi, args.peakRoi);
  const retained = peakRoi != null && peakRoi > 0 ? Math.round((args.currentRoi / peakRoi) * 100) : null;
  const elapsedSec = Math.max(0, (Date.parse(args.observedAt) - Date.parse(args.detectedAt)) / 1000);
  const age = Number.isFinite(elapsedSec) ? elapsedSec < 60 ? `${Math.round(elapsedSec)}s` : `${Math.round(elapsedSec / 60)}m` : null;
  const name = meaningfulTokenName(market.name, market.symbol, args.tokenAddress);
  const risk = sustainedRiskLabel(args.opportunity);
  const snapshot = {
    ...args.rawData, tokenAddress: args.tokenAddress, symbol: market.symbol, name,
    marketCap: market.marketCap, fdv: market.marketCap == null ? market.fdv : null,
    liquidity: market.liquidity, volume5m: market.volume5m, chartUrl: args.target.chartUrl ?? null,
    currentRoi: args.currentRoi, peakRoi, retainedPeakPercent: retained, elapsedSec,
    intelligenceState: args.state, riskLabel: risk, observedAt: args.observedAt,
  };
  const confirmedDevSell = args.rawData.confirmedDevSell === true;
  const criticalRisk = args.rawData.criticalSecurity === true || args.rawData.liquidityCritical === true ||
    args.rawData.criticalLiquidityRisk === true;
  const eligibleForBuilding = Boolean(market.symbol || name) && args.currentRoi > 0 &&
    retained != null && retained >= DEFAULT_SUSTAINED_INTELLIGENCE_CONFIG.retainedMoveRatio * 100 &&
    !confirmedDevSell && !criticalRisk;
  const message = renderPonsPremiumIntelligence({
    state: args.state, symbol: market.symbol, name, address: args.tokenAddress, age, market, evidence,
    move: args.currentRoi, peakMove: peakRoi, retainedPeakPercent: retained, risk, confirmedDevSell,
  });
  const opportunityId = args.opportunity?.id;
  const strategyKey = args.opportunity?.strategy_key;
  const actions = buildAlphaMarketActions({
    chartUrl: args.target.chartUrl, tokenUrl: args.target.tokenUrl,
    copyContractCallback: /^0x[a-fA-F0-9]{40}$/.test(args.tokenAddress) ? `COPY_CA_${args.tokenAddress}` : null,
    trackCallback: opportunityId == null ? null : `OPP_TRACK_${opportunityId}`,
    muteCallback: strategyKey && Buffer.byteLength(`STRAT_TOGGLE_${strategyKey}`, 'utf8') <= 64
      ? `STRAT_TOGGLE_${strategyKey}` : null,
  });
  return { message, actions, snapshot, eligibleForBuilding };
}

async function resolvePonsSustainedPresentation(args: {
  row: ShadowRow; state: 'BUILDING' | 'RUNNER'; currentRoi: number; peakRoi: number | null; observedAt: string;
}) {
  const { data, error } = await supabase.from('opportunities')
    .select('id,asset_id,chain,strategy_key,risk_score,raw_data')
    .eq('asset_id', args.row.token_address).eq('chain', 'robinhood')
    .eq('strategy_key', args.state === 'RUNNER' ? 'PONS_BREAKOUT' : 'PONS_IGNITION')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (error) console.warn('[PonsSustained] Opportunity context lookup failed:', error.message);
  const opportunity = (data as SustainedOpportunity | null) ?? null;
  const baseRawData = mergePonsLifecycleContext(opportunity?.raw_data, {
    address: args.row.token_address, devHoldingPercent: args.row.dev_holding_percent,
    devHoldingEvidence: args.row.dev_holding_percent == null ? 'UNAVAILABLE' : 'VERIFIED',
  });
  let resolved;
  try {
    resolved = await resolvePonsDeliveryContext({
      asset_id: args.row.token_address, chain: 'robinhood', raw_data: baseRawData,
    });
  } catch (error) {
    console.warn('[PonsSustained] Bounded context recovery failed:', {
      token: args.row.token_address,
      error: error instanceof Error ? error.message : String(error),
    });
    resolved = {
      rawData: baseRawData,
      target: { tokenUrl: `https://robinhoodchain.blockscout.com/token/${args.row.token_address}` },
    };
  }
  const {
    marketCap: _staleMarketCap, fdv: _staleFdv, liquidity: _staleLiquidity,
    volume5m: _staleVolume5m, chartUrl: _staleChartUrl, ...lifecycleRawData
  } = resolved.rawData;
  const indexed = resolved.target.marketIndexState === 'VERIFIED';
  const rawData = {
    ...lifecycleRawData,
    ...(indexed ? (resolved.target.marketContext ?? {}) : {}),
    marketIndexState: resolved.target.marketIndexState ?? resolved.rawData.marketIndexState,
  };
  return buildPonsSustainedPresentation({ state: args.state, tokenAddress: args.row.token_address,
    detectedAt: args.row.detected_at, currentRoi: args.currentRoi, peakRoi: args.peakRoi,
    observedAt: args.observedAt, opportunity, rawData,
    target: { tokenUrl: resolved.target.tokenUrl, chartUrl: resolved.target.chartUrl },
  });
}


function shouldCaptureCheckpoint(args: {
  elapsedMs:
    number;

  targetMs:
    number;

  existingPrice:
    number | null;
}): boolean {
  return (
    args.elapsedMs >=
      args.targetMs &&
    args.existingPrice ==
      null
  );
}


function addCheckpointUpdates(args: {
  row:
    ShadowRow;

  elapsedMs:
    number;

  currentPrice:
    number;

  currentRoi:
    number;

  updates:
    ShadowUpdate;
}): void {
  const {
    row,
    elapsedMs,
    currentPrice,
    currentRoi,
    updates,
  } =
    args;


  /*
   * 5 seconds
   */
  if (
    shouldCaptureCheckpoint({
      elapsedMs,

      targetMs:
        5_000,

      existingPrice:
        row.price_5s,
    })
  ) {
    updates.price_5s =
      currentPrice;

    updates.roi_5s_percent =
      currentRoi;


    console.log(
      '[PonsShadowTracker] 5s checkpoint:',
      {
        token:
          row.token_address,

        roi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),
      },
    );
  }


  /*
   * 10 seconds
   */
  if (
    shouldCaptureCheckpoint({
      elapsedMs,

      targetMs:
        10_000,

      existingPrice:
        row.price_10s,
    })
  ) {
    updates.price_10s =
      currentPrice;

    updates.roi_10s_percent =
      currentRoi;


    console.log(
      '[PonsShadowTracker] 10s checkpoint:',
      {
        token:
          row.token_address,

        roi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),
      },
    );
  }


  /*
   * 30 seconds
   */
  if (
    shouldCaptureCheckpoint({
      elapsedMs,

      targetMs:
        30_000,

      existingPrice:
        row.price_30s,
    })
  ) {
    updates.price_30s =
      currentPrice;

    updates.roi_30s_percent =
      currentRoi;


    console.log(
      '[PonsShadowTracker] 30s checkpoint:',
      {
        token:
          row.token_address,

        roi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),
      },
    );
  }


  /*
   * 1 minute
   */
  if (
    shouldCaptureCheckpoint({
      elapsedMs,

      targetMs:
        60_000,

      existingPrice:
        row.price_1m,
    })
  ) {
    updates.price_1m =
      currentPrice;

    updates.roi_1m_percent =
      currentRoi;


    console.log(
      '[PonsShadowTracker] 1m checkpoint:',
      {
        token:
          row.token_address,

        roi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),
      },
    );
  }


  /*
   * 2 minutes
   */
  if (
    shouldCaptureCheckpoint({
      elapsedMs,

      targetMs:
        120_000,

      existingPrice:
        row.price_2m,
    })
  ) {
    updates.price_2m =
      currentPrice;

    updates.roi_2m_percent =
      currentRoi;


    console.log(
      '[PonsShadowTracker] 2m checkpoint:',
      {
        token:
          row.token_address,

        roi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),
      },
    );
  }


  /*
   * 5 minutes
   */
  if (
    shouldCaptureCheckpoint({
      elapsedMs,

      targetMs:
        300_000,

      existingPrice:
        row.price_5m,
    })
  ) {
    updates.price_5m =
      currentPrice;

    updates.roi_5m_percent =
      currentRoi;


    console.log(
      '[PonsShadowTracker] 5m checkpoint:',
      {
        token:
          row.token_address,

        roi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),
      },
    );
  }
}


function addPeakUpdates(args: {
  row:
    ShadowRow;

  currentPrice:
    number;

  currentRoi:
    number;

  updates:
    ShadowUpdate;
}): void {
  const existingPeakRoi =
    validNumber(
      args.row
        .peak_roi_percent,
    )
      ? args.row
          .peak_roi_percent
      : 0;


  if (
    args.currentRoi >
    existingPeakRoi
  ) {
    args.updates.peak_roi_percent =
      args.currentRoi;

    args.updates.peak_price =
      args.currentPrice;
  }
}


function addTakeProfitUpdates(args: {
  row:
    ShadowRow;

  currentRoi:
    number;

  nowIso:
    string;

  updates:
    ShadowUpdate;
}): void {
  const {
    row,
    currentRoi,
    nowIso,
    updates,
  } =
    args;


  /*
   * +100% means price is 2X entry.
   */
  if (
    currentRoi >=
      100 &&
    !row.tp_100_hit
  ) {
    updates.tp_100_hit =
      true;

    updates.tp_100_hit_at =
      nowIso;


    console.log(
      '[PonsShadowTracker] 🎯 TP100 HIT:',
      {
        token:
          row.token_address,

        roi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),
      },
    );
  }


  /*
   * +200% means price is 3X entry.
   */
  if (
    currentRoi >=
      200 &&
    !row.tp_200_hit
  ) {
    updates.tp_200_hit =
      true;

    updates.tp_200_hit_at =
      nowIso;


    console.log(
      '[PonsShadowTracker] 🎯 TP200 HIT:',
      {
        token:
          row.token_address,

        roi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),
      },
    );
  }


  /*
   * +500% means price is 6X entry.
   */
  if (
    currentRoi >=
      500 &&
    !row.tp_500_hit
  ) {
    updates.tp_500_hit =
      true;

    updates.tp_500_hit_at =
      nowIso;


    console.log(
      '[PonsShadowTracker] 🚀 TP500 HIT:',
      {
        token:
          row.token_address,

        roi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),
      },
    );
  }


  /*
   * +1000% means price is 11X entry.
   */
  if (
    currentRoi >=
      1000 &&
    !row.tp_1000_hit
  ) {
    updates.tp_1000_hit =
      true;

    updates.tp_1000_hit_at =
      nowIso;


    console.log(
      '[PonsShadowTracker] 🌕 TP1000 HIT:',
      {
        token:
          row.token_address,

        roi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),
      },
    );
  }
}


async function maybeCheckDevMovement(args: {
  row:
    ShadowRow;

  currentRoi:
    number;

  updates:
    ShadowUpdate;
}): Promise<void> {
  const {
    row,
    currentRoi,
    updates,
  } =
    args;


  /*
   * Once first movement has been captured,
   * we never need to find it again.
   */
  if (
    row.dev_first_movement_at
  ) {
    return;
  }


  const now =
    Date.now();


  const lastCheck =
    lastDevCheckAt.get(
      row.token_address,
    ) ??
    0;


  if (
    now -
      lastCheck <
    DEV_CHECK_INTERVAL_MS
  ) {
    return;
  }


  lastDevCheckAt.set(
    row.token_address,
    now,
  );


  let result:
    Awaited<
      ReturnType<
        typeof scanRobinhoodDevHolding
      >
    >;


  try {
    result =
      await scanRobinhoodDevHolding(
        row.token_address,
      );
  } catch (error) {
    console.log(
      '[PonsShadowTracker] Dev scan failed:',
      {
        token:
          row.token_address,

        error:
          error instanceof Error
            ? error.message
            : String(
                error,
              ),
      },
    );


    return;
  }


  const currentDevHolding =
    result.holdingPercent;


  if (
    currentDevHolding ==
    null
  ) {
    return;
  }


  /*
   * If launch-time dev data was unavailable,
   * establish the first successful reading
   * as our Shadow V1 baseline.
   */
  if (
    row.dev_holding_percent ==
    null
  ) {
    updates.dev_holding_percent =
      currentDevHolding;


    console.log(
      '[PonsShadowTracker] Dev baseline established:',
      {
        token:
          row.token_address,

        devHolding:
          currentDevHolding,
      },
    );


    return;
  }


  const reduction =
    row.dev_holding_percent -
    currentDevHolding;


  if (
    reduction <=
    DEV_MOVEMENT_EPSILON_PERCENT
  ) {
    return;
  }


  const nowIso =
    new Date()
      .toISOString();


  updates.dev_first_movement_at =
    nowIso;

  updates.dev_first_movement_roi_percent =
    currentRoi;


  console.log(
    '[PonsShadowTracker] 🚨 DEV MOVEMENT DETECTED:',
    {
      token:
        row.token_address,

      initialDevHolding:
        row.dev_holding_percent,

      currentDevHolding,

      reduction,

      roiAtMovement:
        Number(
          currentRoi.toFixed(
            2,
          ),
        ),
    },
  );
}



async function updateShadowRow(
  row:
    ShadowRow,
): Promise<void> {

  if (
    row.launch_version ===
      'V2' &&
    row.curve_address &&
    row.shadow_investment_raw &&
    row.shadow_tokens_bought_raw
  ) {
    const entryTimestamp =
      row.would_buy_at ??
      row.detected_at;

    const entryTime =
      new Date(
        entryTimestamp,
      ).getTime();

    if (
      !Number.isFinite(
        entryTime,
      )
    ) {
      return;
    }

    const elapsedMs =
      Date.now() -
      entryTime;

    let investmentRaw:
      bigint;

    let tokensBoughtRaw:
      bigint;

    try {
      investmentRaw =
        BigInt(
          row.shadow_investment_raw,
        );

      tokensBoughtRaw =
        BigInt(
          row.shadow_tokens_bought_raw,
        );
    } catch {
      return;
    }

    if (
      investmentRaw <=
        0n ||
      tokensBoughtRaw <=
        0n
    ) {
      return;
    }

    try {
      const curveState =
        await getPonsV2CurveState(
          row.curve_address,
        );

      if (
        !curveState.nativeQuote
      ) {
        return;
      }

      if (
        curveState.graduated
      ) {
        return;
      }

      const sellQuote =
        quotePonsV2Sell({
          state:
            curveState,

          tokensInRaw:
            tokensBoughtRaw,
        });

      const recoveredRaw =
        sellQuote.quoteOutRaw;

      const currentRoi =
        (
          Number(
            recoveredRaw,
          ) /
          Number(
            investmentRaw,
          ) -
          1
        ) *
        100;

      const currentPrice =
        Number(
          recoveredRaw,
        ) /
        1e18;

      if (
        !Number.isFinite(
          currentPrice,
        ) ||
        !Number.isFinite(
          currentRoi,
        )
      ) {
        return;
      }

      const nowIso =
        new Date()
          .toISOString();

      const updates:
        ShadowUpdate = {
          updated_at:
            nowIso,
        };

      addPeakUpdates({
        row,
        currentPrice,
        currentRoi,
        updates,
      });

      addCheckpointUpdates({
        row,
        elapsedMs,
        currentPrice,
        currentRoi,
        updates,
      });

      addTakeProfitUpdates({
        row,
        currentRoi,
        nowIso,
        updates,
      });

      try {
        await maybeCheckDevMovement({
          row,
          currentRoi,
          updates,
        });
      } catch {
        // best effort only
      }

      if (
        elapsedMs >=
        300_000
      ) {
        updates.shadow_status =
          'COMPLETE';
      }

      const {
        error,
      } =
        await supabase
          .from(
            'pons_shadow_trades',
          )
          .update(
            updates,
          )
          .eq(
            'id',
            row.id,
          );

      if (
        error
      ) {
        console.error(
          '[PonsShadowTracker][V2] Update failed:',
          {
            token:
              row.token_address,

            error:
              error.message,
          },
        );

        return;
      }

      const alphaClassification =
        classifyPonsAlpha({
          elapsedSec:
            elapsedMs /
            1000,

          currentRoi,

          roi5s:
            row.roi_5s_percent,

          roi10s:
            row.roi_10s_percent,

          roi30s:
            row.roi_30s_percent,

          roi1m:
            row.roi_1m_percent,

          roi2m:
            row.roi_2m_percent,

          peakRoi:
            validNumber(
              row.peak_roi_percent,
            )
              ? row.peak_roi_percent
              : null,
        });

      /*
       * ==================================================
       * PERSISTED ALPHA STATE
       * ==================================================
       *
       * Supabase is the source of truth.
       *
       * This prevents duplicate state events after:
       * - Railway restart
       * - redeploy
       * - multiple workers evaluating the same token
       */
      if (
        row.alpha_state !==
        alphaClassification.state
      ) {
        const alphaChangedAt =
          new Date()
            .toISOString();

        const {
          data:
            alphaTransitionRows,
          error:
            alphaTransitionError,
        } =
          await supabase
            .from(
              'pons_shadow_trades',
            )
            .update({
              alpha_state:
                alphaClassification.state,

              alpha_state_changed_at:
                alphaChangedAt,
            })
            .eq(
              'id',
              row.id,
            )
            .or(
              `alpha_state.is.null,alpha_state.neq.${alphaClassification.state}`,
            )
            .select(
              'id',
            );

        if (
          alphaTransitionError
        ) {
          console.error(
            '[PonsAlpha] State persistence failed:',
            {
              token:
                row.token_address,

              state:
                alphaClassification.state,

              error:
                alphaTransitionError.message,
            },
          );
        } else if (
          alphaTransitionRows &&
          alphaTransitionRows.length >
            0
        ) {
          try {
            let preIndexValuation: VerifiedPonsPreIndexValuation | null = null;
            if (!validNumber(row.entry_market_cap) || row.entry_market_cap <= 0) {
              try {
                preIndexValuation = await resolvePonsV2PreIndexValuation(curveState);
              } catch (error) {
                console.warn('[PonsValuation] Pre-index V2 valuation unavailable:', {
                  token: row.token_address,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }
            await syncPonsOpportunity({
              token:
                row.token_address,

              marketCap:
                row.entry_market_cap,

              liquidity:
                row.entry_liquidity,

              devHoldingPercent:
                row.dev_holding_percent,

              preIndexValuation,

              creatorRisk: await evaluateRobinhoodCreatorRisk(row.deployer_address),

              state:
                alphaClassification.state,

              reason:
                alphaClassification.reason,

              currentRoi,

              roiChange:
                alphaClassification.roiChange,

              recentPeakRoi:
                alphaClassification.recentPeakRoi,

              elapsedSec:
                Math.floor(
                  elapsedMs /
                    1000,
                ),
            });
          } catch (error) {
            console.error(
              '[PonsOpportunity] Sync failed:',
              {
                token:
                  row.token_address,

                state:
                  alphaClassification.state,

                error:
                  error instanceof Error
                    ? error.message
                    : String(
                        error,
                      ),
              },
            );
          }

          console.log(
            `[PonsAlpha] state=${
              alphaClassification.state
            } token=${
              row.token_address
            } elapsed=${
              Math.floor(
                elapsedMs /
                1000,
              )
            }s roi=${
              currentRoi.toFixed(
                2,
              )
            }% change=${
              alphaClassification.roiChange ==
              null
                ? 'n/a'
                : `${alphaClassification.roiChange.toFixed(
                    2,
                  )}%`
            } peak=${
              alphaClassification.recentPeakRoi ==
              null
                ? 'n/a'
                : `${alphaClassification.recentPeakRoi.toFixed(
                    2,
                  )}%`
            } actionable=${
              alphaClassification.actionable
            } reason="${
              alphaClassification.reason
            }"`,
          );
                    /*
           * USER ALERTS — PHASE 1
           *
           * Only actionable states are
           * broadcast. Everything else stays
           * internal.
           */
          if (
            alphaClassification.state ===
              'ENTRY_WINDOW' ||
            alphaClassification.state ===
              'FAST_BREAKOUT'
          ) {
            const alertFlag =
              alphaClassification.state ===
              'ENTRY_WINDOW'
                ? 'alpha_entry_alert_sent'
                : 'alpha_breakout_alert_sent';

            const alreadySent =
              alphaClassification.state ===
              'ENTRY_WINDOW'
                ? row.alpha_entry_alert_sent
                : row.alpha_breakout_alert_sent;

            if (!alreadySent) {
              const {
                data:
                  reservedAlert,
                error:
                  reserveError,
              } =
                await supabase
                  .from(
                    'pons_shadow_trades',
                  )
                  .update({
                    [alertFlag]:
                      true,
                  })
                  .eq(
                    'id',
                    row.id,
                  )
                  .eq(
                    alertFlag,
                    false,
                  )
                  .select(
                    'id',
                  );

              if (
                !reserveError &&
                reservedAlert &&
                reservedAlert.length > 0
              ) {
                await broadcastPonsAlphaAlert({
                  state:
                    alphaClassification.state,

                  token:
                    row.token_address,

                  roi:
                    currentRoi,

                  change:
                    alphaClassification.roiChange,

                  elapsedSec:
                    Math.floor(
                      elapsedMs /
                        1000,
                    ),

                  reason:
                    alphaClassification.reason,
                });
              }
            }
          }
        }
      }

      await recordPonsRuntimeTransition({ row, classifiedState: alphaClassification.state,
        currentRoi, peakRoi: alphaClassification.recentPeakRoi, observedAt: nowIso });


      console.log(
        '[PonsShadowTracker][V2] Curve ROI:',
        {
          token:
            row.token_address,

          elapsedSec:
            Math.floor(
              elapsedMs /
              1000,
            ),

          exitValueEth:
            currentPrice,

          roi:
            Number(
              currentRoi.toFixed(
                2,
              ),
            ),
        },
      );

      if (
        elapsedMs >=
        300_000
        ) {
        lastDevCheckAt.delete(
            row.token_address,
        );

        }

      return;
    } catch (error) {
      console.log(
        '[PonsShadowTracker][V2] Curve valuation failed:',
        {
          token:
            row.token_address,

          error:
            error instanceof Error
              ? error.message
              : String(
                  error,
                ),
        },
      );

      return;
    }
  }

  const entryPrice =
    Number(
      row.entry_price,
    );


  if (
    !Number.isFinite(
      entryPrice,
    ) ||
    entryPrice <= 0
  ) {
    /*
     * Dex/indexing data might not have been
     * ready when the launch was first seen.
     *
     * Try to establish an entry reference
     * from the earliest later snapshot.
     */
    let market:
      Awaited<
        ReturnType<
          typeof getRobinhoodMarketSnapshot
        >
      >;


    try {
      market =
        await getRobinhoodMarketSnapshot(
          row.token_address,
        );
    } catch {
      return;
    }


    if (
      !market ||
      !validNumber(
        market.priceUsd,
      ) ||
      market.priceUsd <= 0
    ) {
      return;
    }


    const nowIso =
      new Date()
        .toISOString();


    const {
      error,
    } =
      await supabase
        .from(
          'pons_shadow_trades',
        )
        .update({
          entry_price:
            market.priceUsd,

          entry_market_cap:
            market.marketCapUsd,

          entry_liquidity:
            market.liquidityUsd,

          launch_price:
            market.priceUsd,

          launch_market_cap:
            market.marketCapUsd,

          launch_liquidity:
            market.liquidityUsd,

          peak_price:
            market.priceUsd,

          peak_roi_percent:
            0,

          updated_at:
            nowIso,
        })
        .eq(
          'id',
          row.id,
        );


    if (
      error
    ) {
      console.error(
        '[PonsShadowTracker] Entry reference update failed:',
        {
          token:
            row.token_address,

          error:
            error.message,
        },
      );
    } else {
      console.log(
        '[PonsShadowTracker] Late entry reference established:',
        {
          token:
            row.token_address,

          price:
            market.priceUsd,

          marketCap:
            market.marketCapUsd,
        },
      );
    }


    return;
  }


  const entryTimestamp =
    row.would_buy_at ??
    row.detected_at;


  const entryTime =
    new Date(
      entryTimestamp,
    ).getTime();


  if (
    !Number.isFinite(
      entryTime,
    )
  ) {
    return;
  }


  const elapsedMs =
    Date.now() -
    entryTime;


  let market:
    Awaited<
      ReturnType<
        typeof getRobinhoodMarketSnapshot
      >
    >;


  try {
    market =
      await getRobinhoodMarketSnapshot(
        row.token_address,
      );
  } catch (error) {
    console.log(
      '[PonsShadowTracker] Market snapshot failed:',
      {
        token:
          row.token_address,

        error:
          error instanceof Error
            ? error.message
            : String(
                error,
              ),
      },
    );


    return;
  }


  if (
    !market ||
    !validNumber(
      market.priceUsd,
    ) ||
    market.priceUsd <= 0
  ) {
    return;
  }


  const currentPrice =
    market.priceUsd;


  const currentRoi =
    calculateRoi(
      entryPrice,
      currentPrice,
    );


  const nowIso =
    new Date()
      .toISOString();


  const updates:
    ShadowUpdate = {
      updated_at:
        nowIso,
    };


  addPeakUpdates({
    row,

    currentPrice,

    currentRoi,

    updates,
  });


  addCheckpointUpdates({
    row,

    elapsedMs,

    currentPrice,

    currentRoi,

    updates,
  });


  addTakeProfitUpdates({
    row,

    currentRoi,

    nowIso,

    updates,
  });


  await maybeCheckDevMovement({
    row,

    currentRoi,

    updates,
  });


  /*
   * Once 5 minutes have elapsed, record the
   * final checkpoint and mark the experiment
   * complete.
   *
   * The next version can continue monitoring
   * moonbags beyond five minutes.
   */
  if (
    elapsedMs >=
    300_000
  ) {
    updates.shadow_status =
      'COMPLETE';
  }


  const {
    error,
  } =
    await supabase
      .from(
        'pons_shadow_trades',
      )
      .update(
        updates,
      )
      .eq(
        'id',
        row.id,
      );


  if (
    error
  ) {
    console.error(
      '[PonsShadowTracker] Update failed:',
      {
        token:
          row.token_address,

        error:
          error.message,
      },
    );


    return;
  }


  if (
    elapsedMs >=
    300_000
  ) {
    lastDevCheckAt.delete(
      row.token_address,
    );


    console.log(
      '[PonsShadowTracker] ✅ TRACKING COMPLETE:',
      {
        token:
          row.token_address,

        final5mRoi:
          Number(
            currentRoi.toFixed(
              2,
            ),
          ),

        peakRoi:
          Math.max(
            currentRoi,

            Number(
              row.peak_roi_percent ??
              0,
            ),
          ),

        tp100:
          Boolean(
            row.tp_100_hit ||
            currentRoi >=
              100,
          ),

        tp200:
          Boolean(
            row.tp_200_hit ||
            currentRoi >=
              200,
          ),

        tp500:
          Boolean(
            row.tp_500_hit ||
            currentRoi >=
              500,
          ),

        tp1000:
          Boolean(
            row.tp_1000_hit ||
            currentRoi >=
              1000,
          ),
      },
    );
  }
}


export async function refreshPonsShadowOutcomeTracker():
Promise<void> {
  if (
    trackerRunning
  ) {
    return;
  }


  trackerRunning =
    true;


  try {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          'pons_shadow_trades',
        )
        .select(
          `
            id,
            token_address,
            launch_version,
            curve_address,
            shadow_investment_raw,
            shadow_tokens_bought_raw,
            shadow_quote_asset,
            deployer_address,
            detected_at,
            would_buy_at,
            entry_price,
            entry_market_cap,
            entry_liquidity,
            dev_holding_percent,
            price_5s,
            roi_5s_percent,
            price_10s,
            roi_10s_percent,
            price_30s,
            roi_30s_percent,
            price_1m,
            roi_1m_percent,
            price_2m,
            roi_2m_percent,
            price_5m,
            roi_5m_percent,
            peak_price,
            peak_roi_percent,
            dev_first_movement_at,
            dev_first_movement_roi_percent,
            tp_100_hit,
            tp_200_hit,
            tp_500_hit,
            tp_1000_hit,
            tp_100_hit_at,
            tp_200_hit_at,
            tp_500_hit_at,
            tp_1000_hit_at,
            shadow_status,
            updated_at,
            alpha_state,
            alpha_state_changed_at,
            alpha_entry_alert_sent,
            alpha_breakout_alert_sent,
            alpha_exit_alert_sent
            ,intelligence_state
            ,intelligence_state_observed_at
          `,
        )
        .eq(
            'shadow_status',
            'TRACKING',
            )
            .not(
            'shadow_tokens_bought_raw',
            'is',
            null,
            )
            .not(
            'curve_address',
            'is',
            null,
            )
            .order(
            'detected_at',
            {
                ascending:
                false,
            },
            )
            .limit(
            MAX_ROWS_PER_CYCLE,
            );


    if (
      error
    ) {
      console.error(
        '[PonsShadowTracker] Query failed:',
        error.message,
      );


      return;
    }


    const rows =
      (
        data ??
        []
      ) as ShadowRow[];


    if (
      rows.length ===
      0
    ) {
      return;
    }


    /*
     * Keep processing sequential for V1.
     *
     * Because the outer tracker runs once per
     * second, this avoids hammering RPC/Supabase.
     *
     * If launch volume proves high, we'll
     * introduce controlled concurrency.
     */
    for (
      const row
      of rows
    ) {
      try {
        await updateShadowRow(
          row,
        );
      } catch (error) {
        console.error(
          '[PonsShadowTracker] Row failed:',
          {
            token:
              row.token_address,

            error:
              error instanceof Error
                ? error.message
                : String(
                    error,
                  ),
          },
        );
      }
    }
  } catch (error) {
    console.error(
      '[PonsShadowTracker] Cycle failed:',
      error instanceof Error
        ? error.message
        : String(
            error,
          ),
    );
  } finally {
    trackerRunning =
      false;
  }
}


export function startPonsShadowOutcomeTracker():
void {
  if (
    trackerStarted
  ) {
    console.log(
      '[PonsShadowTracker] Already started.',
    );


    return;
  }


  trackerStarted =
    true;


  console.log(
    `[PonsShadowTracker] Started. Interval: ${
      TRACKER_INTERVAL_MS
    }ms.`,
  );


  void refreshPonsShadowOutcomeTracker();


  trackerInterval =
    setInterval(
      () => {
        void refreshPonsShadowOutcomeTracker();
      },

      TRACKER_INTERVAL_MS,
    );
}


export function stopPonsShadowOutcomeTracker():
void {
  if (
    trackerInterval
  ) {
    clearInterval(
      trackerInterval,
    );


    trackerInterval =
      null;
  }


  trackerStarted =
    false;


  lastDevCheckAt.clear();


  console.log(
    '[PonsShadowTracker] Stopped.',
  );
}
