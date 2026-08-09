import {
  supabase,
} from '../../services/supabase.js';

export type SaveRobinhoodObservationArgs = {
  tokenAddress: string;

  symbol?: string | null;

  name?: string | null;

  source?: string | null;

  pairAddress?: string | null;

  priceAtAlert?: number | null;

  marketCapAtAlert?: number | null;

  liquidityAtAlert?: number | null;

  securityScore?: number | null;

  adminPenalty?: number | null;

  sellStatus?: string | null;

  sellImpactPercent?: number | null;

  holderRisk?: string | null;

  holderTop1Percent?: number | null;

  circulatingHolderCount?: number | null;
};

export async function saveRobinhoodObservation(
  args: SaveRobinhoodObservationArgs,
): Promise<string | null> {
  const now =
    new Date().toISOString();

    const normalizedTokenAddress =
    args.tokenAddress
      .trim()
      .toLowerCase();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        'robinhood_observations',
      )
      .upsert(
        {
          token_address:
            normalizedTokenAddress,

          symbol:
            args.symbol ??
            null,

          name:
            args.name ??
            null,

          source:
            args.source ??
            null,

          pair_address:
            args.pairAddress ??
            null,

          alerted_at:
            now,

          decision:
            'WATCH',

          decision_at:
            now,

          price_at_decision:
            args.priceAtAlert ??
            null,

          market_cap_at_decision:
            args.marketCapAtAlert ??
            null,

          liquidity_at_decision:
            args.liquidityAtAlert ??
            null,

          price_at_alert:
            args.priceAtAlert ??
            null,

          market_cap_at_alert:
            args.marketCapAtAlert ??
            null,

          liquidity_at_alert:
            args.liquidityAtAlert ??
            null,

          security_score:
            args.securityScore ??
            null,

          admin_penalty:
            args.adminPenalty ??
            null,

          sell_status:
            args.sellStatus ??
            null,

          sell_impact_percent:
            args.sellImpactPercent ??
            null,

          holder_risk:
            args.holderRisk ??
            null,

          holder_top1_percent:
            args.holderTop1Percent ??
            null,

          circulating_holder_count:
            args.circulatingHolderCount ??
            null,

          status:
            'WATCHING',

          current_price:
            args.priceAtAlert ??
            null,

          peak_price:
            args.priceAtAlert ??
            null,

          roi_now_percent:
            0,

          roi_high_percent:
            0,

          last_checked_at:
            now,

          updated_at:
            now,
        },
        {
          onConflict:
            'token_address',
        },
      )
      .select(
        'id',
      )
      .single();

  if (error) {
    console.error(
      '[RobinhoodObservationStore] Save failed:',
      {
        token:
          args.tokenAddress,

        error:
          error.message,
      },
    );

    return null;
  }

  console.log(
    '[RobinhoodObservationStore] Saved:',
    {
      token:
        args.tokenAddress,

      id:
        data?.id ??
        null,
    },
  );

  return (
    data?.id ??
    null
  );
}

export async function hasRobinhoodObservation(
  tokenAddress: string,
): Promise<boolean> {
  const {
    data,
    error,
  } =
    await supabase
      .from(
        'robinhood_observations',
      )
      .select(
        'id',
      )
      .eq(
          'token_address',
          tokenAddress
            .trim()
            .toLowerCase(),
        )
      .maybeSingle();

  if (error) {
    console.error(
      '[RobinhoodObservationStore] Lookup failed:',
      {
        token:
          tokenAddress,

        error:
          error.message,
      },
    );

    return false;
  }

  return Boolean(data);
}

export type SaveRobinhoodRejectionArgs = {
  tokenAddress: string;

  symbol?: string | null;

  name?: string | null;

  source?: string | null;

  pairAddress?: string | null;

  rejectionStage: string;

  rejectionReason: string;

  priceAtDecision?: number | null;

  marketCapAtDecision?: number | null;

  liquidityAtDecision?: number | null;

  securityScore?: number | null;

  adminPenalty?: number | null;

  sellStatus?: string | null;

  sellImpactPercent?: number | null;

  holderRisk?: string | null;

  holderTop1Percent?: number | null;

  circulatingHolderCount?: number | null;
};

export async function saveRobinhoodRejection(
  args: SaveRobinhoodRejectionArgs,
): Promise<string | null> {
  const now =
    new Date().toISOString();

    const normalizedTokenAddress =
      args.tokenAddress
        .trim()
        .toLowerCase();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        'robinhood_observations',
      )
      .upsert(
        {
          token_address:
            normalizedTokenAddress,

          symbol:
            args.symbol ??
            null,

          name:
            args.name ??
            null,

          source:
            args.source ??
            null,

          pair_address:
            args.pairAddress ??
            null,

          decision:
            'REJECTED',

          rejection_stage:
            args.rejectionStage,

          rejection_reason:
            args.rejectionReason,

          decision_at:
            now,

          price_at_decision:
            args.priceAtDecision ??
            null,

          market_cap_at_decision:
            args.marketCapAtDecision ??
            null,

          liquidity_at_decision:
            args.liquidityAtDecision ??
            null,

          security_score:
            args.securityScore ??
            null,

          admin_penalty:
            args.adminPenalty ??
            null,

          sell_status:
            args.sellStatus ??
            null,

          sell_impact_percent:
            args.sellImpactPercent ??
            null,

          holder_risk:
            args.holderRisk ??
            null,

          holder_top1_percent:
            args.holderTop1Percent ??
            null,

          circulating_holder_count:
            args.circulatingHolderCount ??
            null,

          status:
            'WATCHING',

          current_price:
            args.priceAtDecision ??
            null,

          peak_price:
            args.priceAtDecision ??
            null,

          roi_now_percent:
            0,

          roi_high_percent:
            0,

          last_checked_at:
            now,

          updated_at:
            now,
        },
        {
          onConflict:
            'token_address',
        },
      )
      .select(
        'id',
      )
      .single();

  if (error) {
    console.error(
      '[RobinhoodObservationStore] Rejection save failed:',
      {
        token:
          args.tokenAddress,

        stage:
          args.rejectionStage,

        error:
          error.message,
      },
    );

    return null;
  }

  console.log(
    '[RobinhoodObservationStore] Rejection saved:',
    {
      token:
        args.tokenAddress,

      stage:
        args.rejectionStage,

      id:
        data?.id ??
        null,
    },
  );

  return (
    data?.id ??
    null
  );
}
