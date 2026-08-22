import { supabase } from '../services/supabase.js';

export type OpportunityType =
  | 'TOKEN_PREDEX'
  | 'TOKEN_CREATOR'
  | 'TOKEN_WALLET'
  | 'DEX_CONFIRMATION'
  | 'NFT_MISPRICE'
  | 'NFT_OFFER_ARBITRAGE'
  | 'CEX_DEX_ARB'
  | 'PREDICTION_MARKET'
  | 'NEWS_CATALYST';

export type OpportunityStatus =
  | 'NEW'
  | 'WATCHING'
  | 'APPROVED'
  | 'EXECUTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'REVIEWED';

export type OpportunityAction =
  | 'BUY'
  | 'CHECK_ENTRY'
  | 'TRACK'
  | 'WATCH'
  | 'ADD_TO_WATCHLIST'
  | 'OPEN_TOKEN'
  | 'EXIT'
  | 'IGNORE';

export type OpportunityInput = {
  opportunityType: OpportunityType;
  assetId: string;
  chain?: string | null;
  sourceAgent: string;

  title?: string | null;

  strategyKey?: string | null;
  recommendedAction?: OpportunityAction | null;

  why?: string | null;
  whatHappened?: string | null;
  invalidation?: string | null;
  riskReason?: string | null;

  entryPrice?: number | null;
  exitPrice?: number | null;
  expectedProfit?: number | null;
  expectedProfitPercent?: number | null;

  riskScore?: number;
  confidence?: number;

  status?: OpportunityStatus;

  lastObservedAt?: string | null;
  observationCount?: number;
  expiresAt?: string | null;

  rawData?: Record<string, unknown>;
};

export async function recordOpportunity(
  args: OpportunityInput,
) {
  const now =
    new Date().toISOString();

  /*
   * Phase 2 continuous intelligence:
   *
   * A strategy-tagged token can be observed repeatedly over time.
   * Re-observation updates the active opportunity instead of
   * creating duplicate rows on every intelligence cycle.
   *
   * Legacy opportunities without strategyKey preserve the old
   * insert-only behaviour.
   */
  if (args.strategyKey) {
    const activeStatuses: OpportunityStatus[] = [
      'NEW',
      'WATCHING',
      'APPROVED',
    ];

    let existingQuery =
      supabase
        .from('opportunities')
        .select(
          'id,observation_count,status,created_at,last_observed_at',
        )
        .eq(
          'asset_id',
          args.assetId,
        )
        .eq(
          'strategy_key',
          args.strategyKey,
        )
        .in(
          'status',
          activeStatuses,
        );

    if (args.chain) {
      existingQuery =
        existingQuery.eq(
          'chain',
          args.chain,
        );
    } else {
      existingQuery =
        existingQuery.is(
          'chain',
          null,
        );
    }

    const {
      data: existingRows,
      error: existingError,
    } =
      await existingQuery
        .order(
          'created_at',
          {
            ascending: false,
          },
        )
        .limit(
          1,
        );

    if (existingError) {
      console.warn(
        '[OpportunityRegistry] Existing opportunity lookup failed:',
        {
          assetId:
            args.assetId,

          strategyKey:
            args.strategyKey,

          error:
            existingError.message,
        },
      );
    }

    const existing =
      existingRows?.[0] ??
      null;

    if (existing) {
      const nextObservationCount =
        Math.max(
          1,
          Number(
            existing.observation_count ??
            1,
          ),
        ) + 1;

      const {
        data,
        error,
      } =
        await supabase
          .from('opportunities')
          .update({
            source_agent:
              args.sourceAgent,

            title:
              args.title ?? null,

            recommended_action:
              args.recommendedAction ?? null,

            why:
              args.why ?? null,

            what_happened:
              args.whatHappened ?? null,

            invalidation:
              args.invalidation ?? null,

            risk_reason:
              args.riskReason ?? null,

            entry_price:
              args.entryPrice ?? null,

            exit_price:
              args.exitPrice ?? null,

            expected_profit:
              args.expectedProfit ?? null,

            expected_profit_percent:
              args.expectedProfitPercent ?? null,

            risk_score:
              args.riskScore ?? 50,

            confidence:
              args.confidence ?? 50,

            status:
              args.status ??
              existing.status ??
              'WATCHING',

            last_observed_at:
              args.lastObservedAt ??
              now,

            observation_count:
              nextObservationCount,

            expires_at:
              args.expiresAt ?? null,

            raw_data:
              args.rawData ?? {},

            updated_at:
              now,
          })
          .eq(
            'id',
            existing.id,
          )
          .select()
          .single();

      if (error) {
        console.log(
          'updateOpportunity observation error:',
          {
            id:
              existing.id,

            assetId:
              args.assetId,

            strategyKey:
              args.strategyKey,

            error:
              error.message,
          },
        );

        return null;
      }

      console.log(
        'opportunity re-observed:',
        {
          id:
            data.id,

          strategy:
            args.strategyKey,

          asset:
            args.assetId,

          action:
            args.recommendedAction ?? null,

          confidence:
            args.confidence ?? 50,

          observationCount:
            nextObservationCount,
        },
      );

      return data;
    }
  }

  const { data, error } =
    await supabase
      .from('opportunities')
      .insert({
        opportunity_type:
          args.opportunityType,

        asset_id:
          args.assetId,

        chain:
          args.chain ?? null,

        source_agent:
          args.sourceAgent,

        title:
          args.title ?? null,

        strategy_key:
          args.strategyKey ?? null,

        recommended_action:
          args.recommendedAction ?? null,

        why:
          args.why ?? null,

        what_happened:
          args.whatHappened ?? null,

        invalidation:
          args.invalidation ?? null,

        risk_reason:
          args.riskReason ?? null,

        entry_price:
          args.entryPrice ?? null,

        exit_price:
          args.exitPrice ?? null,

        expected_profit:
          args.expectedProfit ?? null,

        expected_profit_percent:
          args.expectedProfitPercent ?? null,

        risk_score:
          args.riskScore ?? 50,

        confidence:
          args.confidence ?? 50,

        status:
          args.status ?? 'NEW',

        last_observed_at:
          args.lastObservedAt ?? now,

        observation_count:
          Math.max(
            1,
            args.observationCount ?? 1,
          ),

        expires_at:
          args.expiresAt ?? null,

        raw_data:
          args.rawData ?? {},
      })
      .select()
      .single();

  if (error) {
    console.log(
      'recordOpportunity error:',
      {
        assetId:
          args.assetId,

        strategyKey:
          args.strategyKey ?? null,

        error:
          error.message,
      },
    );

    return null;
  }

  console.log(
    'opportunity recorded:',
    {
      id:
        data.id,

      type:
        args.opportunityType,

      strategy:
        args.strategyKey ?? null,

      action:
        args.recommendedAction ?? null,

      asset:
        args.assetId,

      confidence:
        args.confidence ?? 50,

      observationCount:
        args.observationCount ?? 1,
    },
  );

  return data;
}


export async function transitionActiveStrategyOpportunity(
  args: {
    assetId: string;
    chain?: string | null;
    strategyKey: string;

    status: OpportunityStatus;
    recommendedAction?: OpportunityAction | null;

    why?: string | null;
    whatHappened?: string | null;
    invalidation?: string | null;
    riskReason?: string | null;

    confidence?: number | null;
    riskScore?: number | null;

    rawData?: Record<string, unknown>;
  },
) {
  const activeStatuses: OpportunityStatus[] = [
    'NEW',
    'WATCHING',
    'APPROVED',
  ];

  let query =
    supabase
      .from('opportunities')
      .select('id,observation_count')
      .eq(
        'asset_id',
        args.assetId,
      )
      .eq(
        'strategy_key',
        args.strategyKey,
      )
      .in(
        'status',
        activeStatuses,
      );

  if (args.chain) {
    query =
      query.eq(
        'chain',
        args.chain,
      );
  } else {
    query =
      query.is(
        'chain',
        null,
      );
  }

  const {
    data: rows,
    error: lookupError,
  } =
    await query
      .order(
        'updated_at',
        {
          ascending: false,
        },
      )
      .limit(1);

  if (lookupError) {
    console.warn(
      '[OpportunityRegistry] Transition lookup failed:',
      {
        assetId:
          args.assetId,

        strategyKey:
          args.strategyKey,

        error:
          lookupError.message,
      },
    );

    return null;
  }

  const existing =
    rows?.[0] ??
    null;

  /*
   * Important:
   * Do NOT create a useless closed opportunity when no active
   * strategy opportunity exists.
   */
  if (!existing) {
    return null;
  }

  const now =
    new Date().toISOString();

  const nextObservationCount =
    Math.max(
      1,
      Number(
        existing.observation_count ??
        1,
      ),
    ) + 1;

  const {
    data,
    error,
  } =
    await supabase
      .from('opportunities')
      .update({
        status:
          args.status,

        recommended_action:
          args.recommendedAction ??
          null,

        why:
          args.why ??
          null,

        what_happened:
          args.whatHappened ??
          null,

        invalidation:
          args.invalidation ??
          null,

        risk_reason:
          args.riskReason ??
          null,

        confidence:
          args.confidence ??
          null,

        risk_score:
          args.riskScore ??
          null,

        last_observed_at:
          now,

        observation_count:
          nextObservationCount,

        raw_data:
          args.rawData ??
          {},

        updated_at:
          now,
      })
      .eq(
        'id',
        existing.id,
      )
      .select()
      .single();

  if (error) {
    console.warn(
      '[OpportunityRegistry] Transition failed:',
      {
        id:
          existing.id,

        assetId:
          args.assetId,

        strategyKey:
          args.strategyKey,

        error:
          error.message,
      },
    );

    return null;
  }

  console.log(
    'strategy opportunity transitioned:',
    {
      id:
        data.id,

      asset:
        args.assetId,

      strategy:
        args.strategyKey,

      status:
        args.status,

      action:
        args.recommendedAction ??
        null,

      observationCount:
        nextObservationCount,
    },
  );

  return data;
}


export async function updateOpportunityStatus(
  args: {
    id: string | number;
    status: OpportunityStatus;
  },
) {
  const { error } =
    await supabase
      .from('opportunities')
      .update({
        status:
          args.status,

        updated_at:
          new Date().toISOString(),
      })
      .eq(
        'id',
        args.id,
      );

  if (error) {
    console.log(
      'updateOpportunityStatus error:',
      error,
    );
  }
}

export async function getLatestOpportunities(
  limit = 20,
) {
  const { data, error } =
    await supabase
      .from('opportunities')
      .select('*')
      .order(
        'created_at',
        {
          ascending: false,
        },
      )
      .limit(
        limit,
      );

  if (error) {
    console.log(
      'getLatestOpportunities error:',
      error,
    );

    return [];
  }

  return data ?? [];
}
