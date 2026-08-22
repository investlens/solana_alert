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

  return opportunity;
}
