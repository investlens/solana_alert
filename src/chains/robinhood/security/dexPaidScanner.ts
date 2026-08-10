const DEXSCREENER_CHAIN_ID =
  'robinhood';

type DexScreenerOrder = {
  type?:
    string;

  status?:
    string;

  paymentTimestamp?:
    number;
};

export type RobinhoodDexPaidResult = {
  tokenAddress: string;

  dexPaid:
    boolean | null;

  status:
    'PAID'
    | 'NOT_PAID'
    | 'UNKNOWN';

  orderTypes:
    string[];

  orderStatuses:
    string[];

  latestPaymentTimestamp:
    number | null;

  warnings:
    string[];

  scannedAt: number;
};

export async function scanRobinhoodDexPaid(
  tokenAddress: string,
): Promise<RobinhoodDexPaidResult> {
  const warnings:
    string[] = [];

  try {
    const url =
      'https://api.dexscreener.com/orders/v1/' +
      `${DEXSCREENER_CHAIN_ID}/` +
      tokenAddress;

    const response =
      await fetch(
        url,
        {
          headers: {
            Accept:
              'application/json',
          },
        },
      );

    if (!response.ok) {
      return {
        tokenAddress,

        dexPaid:
          null,

        status:
          'UNKNOWN',

        orderTypes:
          [],

        orderStatuses:
          [],

        latestPaymentTimestamp:
          null,

        warnings: [
          `DexScreener orders HTTP ${response.status}`,
        ],

        scannedAt:
          Date.now(),
      };
    }

    const payload =
      await response.json();

    const orders:
      DexScreenerOrder[] =
      Array.isArray(payload)
        ? payload
        : [];

    /*
     * A payment timestamp is the strongest
     * direct indication from this endpoint
     * that a paid order exists.
     *
     * Cancelled/rejected entries are not
     * considered active paid promotion.
     */
    const paidOrders =
      orders.filter(
        (order) =>
          typeof order
            .paymentTimestamp ===
            'number' &&
          order.paymentTimestamp >
            0 &&
          order.status !==
            'cancelled' &&
          order.status !==
            'rejected',
      );

    const timestamps =
      paidOrders
        .map(
          (order) =>
            order.paymentTimestamp!,
        )
        .filter(
          (value) =>
            Number.isFinite(
              value,
            ),
        );

    const latestPaymentTimestamp =
      timestamps.length > 0
        ? Math.max(
            ...timestamps,
          )
        : null;

    return {
      tokenAddress,

      dexPaid:
        paidOrders.length > 0,

      status:
        paidOrders.length > 0
          ? 'PAID'
          : 'NOT_PAID',

      orderTypes:
        [
          ...new Set(
            paidOrders
              .map(
                (order) =>
                  order.type,
              )
              .filter(
                (
                  value,
                ): value is string =>
                  Boolean(value),
              ),
          ),
        ],

      orderStatuses:
        [
          ...new Set(
            paidOrders
              .map(
                (order) =>
                  order.status,
              )
              .filter(
                (
                  value,
                ): value is string =>
                  Boolean(value),
              ),
          ),
        ],

      latestPaymentTimestamp,

      warnings,

      scannedAt:
        Date.now(),
    };
  } catch (error) {
    return {
      tokenAddress,

      dexPaid:
        null,

      status:
        'UNKNOWN',

      orderTypes:
        [],

      orderStatuses:
        [],

      latestPaymentTimestamp:
        null,

      warnings: [
        error instanceof Error
          ? error.message
          : String(error),
      ],

      scannedAt:
        Date.now(),
    };
  }
}
