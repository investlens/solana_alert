import type { AIConviction } from '../../domain/conviction.js';
import type { TokenIdentity } from '../../domain/token.js';
import { supabase } from '../../services/supabase.js';
import { DataCloudError, errorMessage } from './errors.js';

export interface PersistAIDecisionInput {
  decisionKey: string;
  token: TokenIdentity;
  tokenId?: string | null;
  conviction: AIConviction;
  engineName?: string;
  decisionType?: string;
  legacyScore?: number | null;
  featureSnapshot?: Record<string, unknown>;
  dataQuality?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface PersistAIDecisionResult {
  id: string | null;
  inserted: boolean;
  duplicate: boolean;
}

export class AIDecisionRepository {
  async insert(input: PersistAIDecisionInput): Promise<PersistAIDecisionResult> {
    const positiveFactors = input.conviction.contributions.filter((item) => item.points > 0);
    const negativeFactors = input.conviction.contributions.filter((item) => item.points < 0);

    const row = {
      decision_key: input.decisionKey,
      chain: input.token.chain.toLowerCase(),
      token_id: input.tokenId ?? null,
      token_address: input.token.tokenAddress,
      pair_address: input.token.pairAddress ?? null,
      engine_name: input.engineName ?? 'AlphaOS Conviction',
      engine_version: input.conviction.engineVersion,
      decision_type: input.decisionType ?? 'scan',
      verdict: input.conviction.verdict,
      opportunity_score: input.conviction.opportunityScore,
      confidence_score: input.conviction.confidenceScore,
      risk_score: input.conviction.riskScore,
      legacy_score: input.legacyScore ?? null,
      reason_codes: input.conviction.contributions.map((item) => item.code),
      positive_factors: positiveFactors,
      negative_factors: negativeFactors,
      feature_snapshot: input.featureSnapshot ?? {},
      data_quality: input.dataQuality ?? {
        missingEvidence: input.conviction.missingEvidence,
      },
      metadata: {
        action: input.conviction.action,
        reasons: input.conviction.reasons,
        ...(input.metadata ?? {}),
      },
      decided_at: input.conviction.decidedAt,
    };

    const { data, error } = await supabase
      .from('ai_decisions')
      .insert(row)
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        return { id: null, inserted: false, duplicate: true };
      }
      throw new DataCloudError('aiDecision.insert', errorMessage(error), error);
    }

    return { id: data?.id ?? null, inserted: true, duplicate: false };
  }
}

export const aiDecisionRepository = new AIDecisionRepository();
