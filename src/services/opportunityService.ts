import { eventEngine } from './eventEngine.js';
import {
  recordOpportunity,
  type OpportunityType,
  type OpportunityStatus,
} from '../core/opportunityRegistry.js';

export async function recordOpportunityAndEmit(args: {
  opportunityType: OpportunityType;
  assetId: string;
  chain?: string | null;
  sourceAgent: string;
  title?: string |null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  expectedProfit?: number | null;
  expectedProfitPercent?: number | null;
  riskScore?: number;
  confidence?: number;
  status?: OpportunityStatus;
  rawData?: Record<string, unknown>;
}) {
  // Existing behaviour (unchanged)
  const opportunity = await recordOpportunity(args);

  // If the insert failed, preserve existing behaviour.
  if (!opportunity) {
    return null;
  }

  try {
    await eventEngine.emit({
      eventType: 'TOKEN_DISCOVERED',

      source: args.sourceAgent,

      token: {
        chain: args.chain ?? 'solana',
        tokenAddress: args.assetId,
      },

      deduplicationWindowSeconds: 60,

      payload: {
        opportunityId: opportunity.id,

        title: args.title,

        confidence: args.confidence,

        riskScore: args.riskScore,

        expectedProfit: args.expectedProfit,

        expectedProfitPercent: args.expectedProfitPercent,

        rawData: args.rawData ?? {},
      },
    });
  } catch (err) {
    console.warn(
      '[OpportunityService] Event emission failed (ignored):',
      err,
    );
  }

  return opportunity;
}