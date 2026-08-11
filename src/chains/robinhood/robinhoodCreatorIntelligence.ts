import {
  supabase,
} from '../../services/supabase.js';


type RobinhoodCreatorObservation = {
  token_address: string;
  symbol: string | null;
  name: string | null;

  deployer_address: string | null;

  first_seen_at: string | null;
  decision_at: string | null;

  market_cap_at_decision:
    number | null;

  roi_high_percent:
  number | null;

  current_market_cap:
    number | null;

  peak_market_cap:
    number | null;

  roi_1m_percent:
    number | null;

  roi_3m_percent:
    number | null;

  roi_5m_percent:
    number | null;

  roi_15m_percent:
    number | null;
};


function num(
  value: unknown,
): number {
  const n =
    Number(
      value ??
      0,
    );

  return Number.isFinite(
    n,
  )
    ? n
    : 0;
}


function getWorstEarlyReturn(
  row: RobinhoodCreatorObservation,
): number | null {
  const values = [
    row.roi_1m_percent,
    row.roi_3m_percent,
    row.roi_5m_percent,
    row.roi_15m_percent,
  ]
    .filter(
      (
        value,
      ): value is number =>
        value != null &&
        Number.isFinite(
          Number(
            value,
          ),
        ),
    )
    .map(
      Number,
    );

  if (
    values.length ===
    0
  ) {
    return null;
  }

  return Math.min(
    ...values,
  );
}


export async function syncRobinhoodCreatorIntelligence():
Promise<void> {
  const {
    data,
    error,
  } =
    await supabase
      .from(
        'robinhood_observations',
      )
      .select(`
        token_address,
        symbol,
        name,

        deployer_address,

        first_seen_at,
        decision_at,

        market_cap_at_decision,
        current_market_cap,
        peak_market_cap,

        roi_1m_percent,
        roi_3m_percent,
        roi_5m_percent,
        roi_15m_percent,
        roi_high_percent
      `)
      .not(
        'deployer_address',
        'is',
        null,
      )
      .order(
        'decision_at',
        {
          ascending:
            false,
        },
      )
      .limit(
        2000,
      );


  if (error) {
    console.error(
      '[RobinhoodCreatorIntel] Observation load failed:',
      error.message,
    );

    return;
  }


  const rows =
    (
      data ??
      []
    ) as unknown as RobinhoodCreatorObservation[];


  if (
    rows.length ===
    0
  ) {
    console.log(
      '[RobinhoodCreatorIntel] No creator observations available.',
    );

    return;
  }


  let synced =
    0;


  for (
    const row
    of rows
  ) {
    if (
      !row.deployer_address ||
      !row.token_address
    ) {
      continue;
    }


    const initialMarketCap =
      num(
        row.market_cap_at_decision,
      );

    const currentMarketCap =
  num(
    row.current_market_cap,
  );


const peakRoi =
  num(
    row.roi_high_percent,
  );


const estimatedHistoricalPeakMarketCap =
  initialMarketCap > 0 &&
  peakRoi > 0
    ? initialMarketCap *
      (
        1 +
        peakRoi / 100
      )
    : 0;


const peakMarketCap =
  Math.max(
    num(
      row.peak_market_cap,
    ),
    estimatedHistoricalPeakMarketCap,
    initialMarketCap,
    currentMarketCap,
  );


    const worstEarlyReturn =
      getWorstEarlyReturn(
        row,
      );


    const severeCrash =
      worstEarlyReturn != null &&
      worstEarlyReturn <= -80;


    const catastrophicCrash =
      worstEarlyReturn != null &&
      worstEarlyReturn <= -90;


    const launchedAt =
      row.first_seen_at ??
      row.decision_at ??
      new Date()
        .toISOString();


    const {
      error:
        launchError,
    } =
      await supabase
        .from(
          'creator_launches',
        )
        .upsert(
          {
            chain:
              'robinhood',

            creator_wallet:
              row.deployer_address
                .toLowerCase(),

            token:
              row.token_address
                .toLowerCase(),

            symbol:
              row.symbol ??
              null,

            name:
              row.name ??
              null,

            initial_market_cap:
              initialMarketCap ||
              null,

            alert_market_cap:
              initialMarketCap ||
              null,

            current_market_cap:
              currentMarketCap ||
              null,

            peak_market_cap:
              peakMarketCap ||
              null,

            launched_at:
              launchedAt,

            last_checked_at:
              new Date()
                .toISOString(),

            crossed_50k:
              peakMarketCap >=
              50_000,

            crossed_100k:
              peakMarketCap >=
              100_000,

            crossed_250k:
              peakMarketCap >=
              250_000,

            crossed_500k:
              peakMarketCap >=
              500_000,

            crossed_1m:
              peakMarketCap >=
              1_000_000,

            severe_crash:
              severeCrash,

            catastrophic_crash:
              catastrophicCrash,

            return_5m_pct:
              row.roi_5m_percent ??
              null,

            return_15m_pct:
              row.roi_15m_percent ??
              null,

            max_return_pct:
              initialMarketCap > 0
                ? (
                    (
                      peakMarketCap -
                      initialMarketCap
                    ) /
                    initialMarketCap
                  ) *
                  100
                : null,

            tracking_complete:
              false,
          },
          {
            onConflict:
              'chain,token',
          },
        );


    if (launchError) {
      console.error(
        '[RobinhoodCreatorIntel] Launch sync failed:',
        {
          token:
            row.token_address,

          creator:
            row.deployer_address,

          error:
            launchError.message,
        },
      );

      continue;
    }


    synced +=
      1;
  }


  console.log(
    '[RobinhoodCreatorIntel] Sync complete:',
    {
      observations:
        rows.length,

      synced,
    },
  );
}
