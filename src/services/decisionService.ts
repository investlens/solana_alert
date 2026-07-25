import {
  eventEngine,
  type EmitEventResult,
} from './eventEngine.js';

export interface RecordDecisionInput {
  tokenAddress: string;
  chain?: string | null;
  source?: string;

  symbol?: string | null;
  name?: string | null;
  creatorWallet?: string | null;

  baseScore: number;
  adjustedScore: number;
  learningAdjustment: number;
  learningReasons?: unknown[];

  actionBucket: string;
  riskLevel?: string | number | null;

  marketCap?: number | null;
  liquidity?: number | null;
  price?: number | null;
  buys5m?: number | null;
  sells5m?: number | null;
  volume5m?: number | null;

  marketSafetyScore?: number | null;
  authoritySafetyScore?: number | null;
  paidApproved?: boolean | null;
}

/**
 * Records the final AI decision without changing scanner,
 * scoring, filtering, alerting or trading behaviour.
 *
 * Duplicate protection:
 * - Same token
 * - Same base score
 * - Same adjusted score
 * - Same action bucket
 * - Within the same 24-hour deduplication window
 */
export async function recordDecision(
  input: RecordDecisionInput,
): Promise<EmitEventResult | null> {
  const tokenAddress = input.tokenAddress.trim();

  if (!tokenAddress) {
    console.warn(
      '[DecisionService] Decision skipped: missing token address',
    );

    return null;
  }

  const chain = input.chain?.trim() || 'solana';
  const source = input.source?.trim() || 'MAIN_SCANNER';

  /*
   * A score or action change creates a new meaningful decision.
   * An identical repeated scan is treated as a duplicate.
   */
  const deduplicationKey = [
    'decision',
    Math.round(input.baseScore),
    Math.round(input.adjustedScore),
    input.actionBucket.toUpperCase(),
  ].join(':');

  try {
    const result = await eventEngine.emit({
      eventType: 'AI_DECISION_CREATED',

      token: {
        chain,
        tokenAddress,
      },

      source,
      severity:
        input.actionBucket.toUpperCase() === 'BUY'
          ? 'NOTICE'
          : 'INFO',

      deduplicationKey,

      /*
       * Stops the same decision being inserted repeatedly during
       * scanner loops or application restarts.
       */
      deduplicationWindowSeconds: 24 * 60 * 60,

      payload: {
        symbol: input.symbol ?? null,
        name: input.name ?? null,
        creatorWallet: input.creatorWallet ?? null,

        baseScore: input.baseScore,
        adjustedScore: input.adjustedScore,
        finalScore: input.adjustedScore,

        learningAdjustment: input.learningAdjustment,
        learningReasons: input.learningReasons ?? [],

        actionBucket: input.actionBucket,
        decision: input.actionBucket,
        riskLevel: input.riskLevel ?? null,

        marketCapUsd: input.marketCap ?? null,
        liquidityUsd: input.liquidity ?? null,
        priceUsd: input.price ?? null,
        buys5m: input.buys5m ?? null,
        sells5m: input.sells5m ?? null,
        volume5mUsd: input.volume5m ?? null,

        marketSafetyScore:
          input.marketSafetyScore ?? null,

        authoritySafetyScore:
          input.authoritySafetyScore ?? null,

        paidApproved:
          input.paidApproved ?? null,
      },
    });

    if (result.duplicate) {
      console.log(
        `[DecisionService] Duplicate ignored: ${tokenAddress} ` +
        `score=${input.adjustedScore} ` +
        `bucket=${input.actionBucket}`,
      );
    } else if (result.persisted) {
      console.log(
        `[DecisionService] Decision recorded: ${tokenAddress} ` +
        `base=${input.baseScore} ` +
        `adjusted=${input.adjustedScore} ` +
        `bucket=${input.actionBucket}`,
      );
    } else if (result.error) {
      console.warn(
        `[DecisionService] Decision persistence failed but scanner continues: ${result.error.message}`,
      );
    }

    return result;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.warn(
      `[DecisionService] Decision recording failed but scanner continues: ${message}`,
    );

    return null;
  }
}