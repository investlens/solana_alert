import type { ArcWalletRiskEvidence } from './walletRiskShadow.js';

type BitqueryTrade = {
  Block?: { Time?: string };
  TransactionHeader?: { Hash?: string; Index?: number };
  Trader?: { Address?: string };
  Side?: string;
  Amounts?: { Base?: string | number; Quote?: string | number };
  AmountsInUsd?: { Quote?: string | number };
  Pair?: {
    Token?: { Id?: string };
    QuoteToken?: { Id?: string };
    Pool?: { Id?: string };
  };
};

type TradeObservation = {
  wallet: string;
  txHash: string;
  time: string | null;
  side: 'BUY' | 'SELL' | 'UNKNOWN';
  usd: number | null;
};

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();
const finite = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function tokenSide(trade: BitqueryTrade, token: string): 'BUY' | 'SELL' | 'UNKNOWN' {
  const side = String(trade.Side ?? '').toUpperCase();
  const pairToken = normalize(trade.Pair?.Token?.Id);
  const pairQuote = normalize(trade.Pair?.QuoteToken?.Id);
  const wanted = `bid:arc:${normalize(token)}`;
  if (side !== 'BUY' && side !== 'SELL') return 'UNKNOWN';
  if (pairToken === wanted) return side;
  if (pairQuote === wanted) return side === 'BUY' ? 'SELL' : 'BUY';
  return 'UNKNOWN';
}

function tradeQuery(token: string, hours: number, limit: number): string {
  const id = `bid:arc:${normalize(token)}`;
  return `query {
    Trading {
      Trades(
        limit: {count: ${limit}}
        orderBy: {descending: Block_Time}
        where: {
          Block: {Time: {since_relative: {hours_ago: ${hours}}}}
          Pair: {Market: {NetworkBid: {is: "bid:arc"}, ProtocolFamily: {is: "Uniswap"}}}
          any: [
            {Pair: {Token: {Id: {is: "${id}"}}}}
            {Pair: {QuoteToken: {Id: {is: "${id}"}}}}
          ]
        }
      ) {
        Block {Time}
        TransactionHeader {Hash Index}
        Trader {Address}
        Side
        Amounts {Base Quote}
        AmountsInUsd {Quote}
        Pair {Token {Id} QuoteToken {Id} Pool {Id}}
      }
    }
  }`;
}

/**
 * Optional, bounded Bitquery pull used only after a token is already a serious
 * ARC alert candidate. No database writes, no subscriptions and no raw trade
 * persistence. If credentials or evidence are missing we return NOT_CONFIRMED
 * inputs rather than guessing.
 */
export async function collectArcWalletRiskEvidence(
  token: string,
  liquidityUsd: number | null,
): Promise<ArcWalletRiskEvidence> {
  const apiToken = String(process.env.BITQUERY_ACCESS_TOKEN ?? '').trim();
  if (!apiToken) return { liquidityUsd, evidence: ['Bitquery access token unavailable; wallet evidence not confirmed'] };

  const hours = Math.max(1, Math.min(6, Number(process.env.ARC_WALLET_RISK_LOOKBACK_HOURS ?? 2)));
  const limit = Math.max(50, Math.min(500, Number(process.env.ARC_WALLET_RISK_MAX_TRADES ?? 250)));

  try {
    const response = await fetch('https://streaming.bitquery.io/graphql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ query: tradeQuery(token, hours, limit) }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) {
      return { liquidityUsd, evidence: [`Bitquery HTTP ${response.status}; wallet evidence not confirmed`] };
    }

    const payload = await response.json() as any;
    const trades: BitqueryTrade[] = Array.isArray(payload?.data?.Trading?.Trades)
      ? payload.data.Trading.Trades
      : [];

    const observations: TradeObservation[] = trades.map(trade => ({
      wallet: normalize(trade.Trader?.Address),
      txHash: normalize(trade.TransactionHeader?.Hash),
      time: trade.Block?.Time ?? null,
      side: tokenSide(trade, token),
      usd: finite(trade.AmountsInUsd?.Quote),
    })).filter(row => /^0x[0-9a-f]{40}$/.test(row.wallet) && /^0x[0-9a-f]{64}$/.test(row.txHash));

    const buys = observations.filter(row => row.side === 'BUY');
    const sells = observations.filter(row => row.side === 'SELL');
    const uniqueBuyers = new Set(buys.map(row => row.wallet));
    const uniqueSellers = new Set(sells.map(row => row.wallet));

    // Wallet connectivity requires funding/transfer evidence. Trade timing alone
    // must never be presented as proof that wallets are connected.
    return {
      liquidityUsd,
      connectedClusterPct: null,
      evidence: [
        `ephemeral trades=${observations.length}`,
        `unique buyers=${uniqueBuyers.size}`,
        `unique sellers=${uniqueSellers.size}`,
        'connected-wallet percentage not confirmed: funding/transfer graph not yet proven',
      ],
    };
  } catch (error) {
    return {
      liquidityUsd,
      evidence: [`wallet evidence pull failed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
