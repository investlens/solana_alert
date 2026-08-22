import {
  supabase,
} from './supabase.js';

const ACTIVE_STATUSES = [
  'NEW',
  'WATCHING',
  'APPROVED',
];

const SWEEP_INTERVAL_MS =
  30 * 1000;

let started =
  false;

let running =
  false;

let interval:
  NodeJS.Timeout |
  null =
  null;

export async function expireStaleOpportunities():
Promise<number> {
  if (running) {
    return 0;
  }

  running =
    true;

  try {
    const now =
      new Date().toISOString();

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
          confidence,
          risk_score,
          expires_at,
          last_observed_at,
          observation_count,
          raw_data
        `)
        .in(
          'status',
          ACTIVE_STATUSES,
        )
        .not(
          'expires_at',
          'is',
          null,
        )
        .lte(
          'expires_at',
          now,
        );

    if (error) {
      throw error;
    }

    const rows =
      data ?? [];

    if (
      rows.length ===
      0
    ) {
      return 0;
    }

    let expired =
      0;

    for (
      const row
      of rows
    ) {
      const {
        error:
          updateError,
      } =
        await supabase
          .from(
            'opportunities',
          )
          .update({
            status:
              'EXPIRED',

            recommended_action:
              'IGNORE',

            why:
              'This opportunity expired because AlphaOS did not receive sufficiently fresh confirming evidence within the strategy validity window.',

            what_happened:
              `The ${row.strategy_key ?? 'strategy'} thesis became stale after its freshness window elapsed.`,

            invalidation:
              'The previous opportunity is no longer considered live. A new strategy-qualified observation can create a fresh thesis later.',

            risk_reason:
              'Acting on stale market evidence can create poor entries because price, liquidity and momentum may have changed materially.',

            confidence:
              Math.min(
                Number(
                  row.confidence ??
                  50,
                ),
                40,
              ),

            risk_score:
              Math.max(
                Number(
                  row.risk_score ??
                  50,
                ),
                65,
              ),

            updated_at:
              now,

            raw_data: {
              ...(
                row.raw_data &&
                typeof row.raw_data ===
                  'object'
                  ? row.raw_data
                  : {}
              ),

              freshness: {
                expired:
                  true,

                expiredAt:
                  now,

                previousAction:
                  row.recommended_action,

                previousStatus:
                  row.status,

                strategy:
                  row.strategy_key,

                expiresAt:
                  row.expires_at,

                lastObservedAt:
                  row.last_observed_at,
              },
            },
          })
          .eq(
            'id',
            row.id,
          )
          .in(
            'status',
            ACTIVE_STATUSES,
          );

      if (
        updateError
      ) {
        console.warn(
          '[OpportunityFreshness] Expiry update failed:',
          {
            id:
              row.id,

            token:
              row.asset_id,

            strategy:
              row.strategy_key,

            error:
              updateError.message,
          },
        );

        continue;
      }

      expired +=
        1;

      console.log(
        '[OpportunityFreshness] Opportunity expired:',
        {
          id:
            row.id,

          token:
            row.asset_id,

          chain:
            row.chain,

          strategy:
            row.strategy_key,

          previousAction:
            row.recommended_action,

          observations:
            row.observation_count,

          lastObservedAt:
            row.last_observed_at,

          expiresAt:
            row.expires_at,
        },
      );
    }

    return expired;
  } finally {
    running =
      false;
  }
}

export function startOpportunityFreshnessService():
void {
  if (started) {
    return;
  }

  started =
    true;

  console.log(
    `[OpportunityFreshness] Started. Interval: ${
      SWEEP_INTERVAL_MS /
      1000
    } seconds.`,
  );

  void expireStaleOpportunities()
    .catch(
      error => {
        console.error(
          '[OpportunityFreshness] Initial sweep failed:',
          error instanceof Error
            ? error.message
            : String(
                error,
              ),
        );
      },
    );

  interval =
    setInterval(
      () => {
        void expireStaleOpportunities()
          .catch(
            error => {
              console.error(
                '[OpportunityFreshness] Sweep failed:',
                error instanceof Error
                  ? error.message
                  : String(
                      error,
                    ),
              );
            },
          );
      },
      SWEEP_INTERVAL_MS,
    );
}

export function stopOpportunityFreshnessService():
void {
  if (
    interval
  ) {
    clearInterval(
      interval,
    );

    interval =
      null;
  }

  started =
    false;

  console.log(
    '[OpportunityFreshness] Stopped.',
  );
}
