import { governedDexScreenerJson } from '../../../services/dexscreenerRequestGovernor.js';

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

type DexScreenerOrdersPayload = { orders?: unknown; boosts?: unknown };

function isDexScreenerOrder(value: unknown): value is DexScreenerOrder {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const order = value as Record<string, unknown>;
  return (order.type == null || typeof order.type === 'string') &&
    (order.status == null || typeof order.status === 'string') &&
    (order.paymentTimestamp == null || typeof order.paymentTimestamp === 'number');
}

export function parseDexScreenerPaidOrders(payload: unknown): { orders: DexScreenerOrder[]; malformed: boolean } {
  const candidate = Array.isArray(payload) ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as DexScreenerOrdersPayload).orders)
      ? (payload as DexScreenerOrdersPayload).orders as unknown[] : null;
  if (candidate && candidate.every(isDexScreenerOrder)) return { orders: candidate, malformed: false };
  return { orders: [], malformed: true };
}

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

    const payload = (await governedDexScreenerJson<unknown>({ url, caller: 'robinhood_dex_paid', priority: 'NORMAL',
      endpoint: 'ORDERS', cacheKey: `orders:robinhood:${tokenAddress.trim().toLowerCase()}`, cacheTtlMs: 120_000 })).value;

    const parsed = parseDexScreenerPaidOrders(payload);
    if (parsed.malformed) throw new Error('DexScreener orders response was malformed');
    const orders = parsed.orders;

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
