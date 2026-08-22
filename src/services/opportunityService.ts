import {
  eventEngine,
} from './eventEngine.js';

import {
  recordOpportunity,
  type OpportunityInput,
} from '../core/opportunityRegistry.js';

export type RecordOpportunityAndEmitInput =
  OpportunityInput;

export async function recordOpportunityAndEmit(
  args: RecordOpportunityAndEmitInput,
) {
  /*
   * Preserve the existing opportunity persistence flow,
   * now with Phase 2 strategy intelligence attached.
   */
  const opportunity =
    await recordOpportunity(
      args,
    );

  if (!opportunity) {
    return null;
  }

  try {
    await eventEngine.emit({
      eventType:
        'TOKEN_DISCOVERED',

      source:
        args.sourceAgent,

      token: {
        chain:
          args.chain ??
          'solana',

        tokenAddress:
          args.assetId,
      },

      deduplicationWindowSeconds:
        60,

      payload: {
        opportunityId:
          opportunity.id,

        opportunityType:
          args.opportunityType,

        strategyKey:
          args.strategyKey ??
          null,

        recommendedAction:
          args.recommendedAction ??
          null,

        title:
          args.title ??
          null,

        why:
          args.why ??
          null,

        whatHappened:
          args.whatHappened ??
          null,

        invalidation:
          args.invalidation ??
          null,

        riskReason:
          args.riskReason ??
          null,

        confidence:
          args.confidence ??
          null,

        riskScore:
          args.riskScore ??
          null,

        expectedProfit:
          args.expectedProfit ??
          null,

        expectedProfitPercent:
          args.expectedProfitPercent ??
          null,

        lastObservedAt:
          args.lastObservedAt ??
          null,

        observationCount:
          args.observationCount ??
          1,

        expiresAt:
          args.expiresAt ??
          null,

        rawData:
          args.rawData ??
          {},
      },
    });
  } catch (error) {
    console.warn(
      '[OpportunityService] Event emission failed (ignored):',
      error,
    );
  }

  const actionableActions =
    new Set([
      'BUY',
      'CHECK_ENTRY',
      'EXIT',
    ]);

  const opportunityStatus =
    String(
      opportunity.status ??
      '',
    ).toUpperCase();

  const opportunityAction =
    String(
      opportunity.recommended_action ??
      args.recommendedAction ??
      '',
    ).toUpperCase();

  /*
   * Delivery semantics:
   *
   * - WATCH/TRACK remain intelligence only.
   * - Only a currently NEW actionable thesis is surfaced.
   * - Persistent opportunity_deliveries prevents the same
   *   opportunity from being sent twice to the same user.
   *
   * This also allows a previously WATCHING opportunity to
   * become NEW/CHECK_ENTRY later and become deliverable.
   */
  if (
    args.strategyKey &&
    opportunityStatus === 'NEW' &&
    actionableActions.has(
      opportunityAction,
    )
  ) {
    try {
      await eventEngine.emit({
        eventType:
          'OPPORTUNITY_ACTIONABLE',

        source:
          args.sourceAgent,

        token: {
          chain:
            args.chain ??
            'solana',

          tokenAddress:
            args.assetId,
        },

        deduplicationKey:
          [
            'opportunity',
            opportunity.id,
            opportunityAction,
          ].join(':'),

        deduplicationWindowSeconds:
          24 * 60 * 60,

        payload: {
          opportunityId:
            opportunity.id,

          strategyKey:
            args.strategyKey,

          recommendedAction:
            opportunityAction,

          confidence:
            opportunity.confidence ??
            args.confidence ??
            null,

          riskScore:
            opportunity.risk_score ??
            args.riskScore ??
            null,
        },
      });
    } catch (error) {
      console.warn(
        '[OpportunityService] Actionable event failed (ignored):',
        error,
      );
    }
  }

  return opportunity;
}
