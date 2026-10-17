// Offline research only. No providers, persistence, timers or delivery imports.
// PONS page trade rows are reported activity, not verified swap receipts.
export type DemandScope = { token: string; creator: string; venue: string; observedAt: number };
export type ReportedTrade = { id: string; wallet: string; side: 'buy' | 'sell'; at: number; quoteAmount: number };
export type DemandWindow = DemandScope & { source: 'PONS_REPORTED'; from: number; trades: ReportedTrade[] };
export type WindowRead = { window: DemandWindow | null; reason: string };
const address = (v: unknown): v is string => typeof v === 'string' && /^0x[a-f0-9]{40}$/i.test(v) && !/^0x0{40}$/i.test(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const venue = (v: unknown): v is string => typeof v === 'string' && /^0x(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(v) && !/^0x0+$/i.test(v);
const scopeValid = (s: DemandScope) => s && address(s.token) && address(s.creator) && venue(s.venue)
  && s.token.toLowerCase() !== s.creator.toLowerCase() && finite(s.observedAt) && s.observedAt > 300_000;

/** Caller must bind this page to an exact token/creator/venue using provenance
 * verification. This validates a complete five-minute page window, not identity.
 * No pagination is fetched. Duplicate/conflicting IDs fail the whole window. */
export function readReportedDemandWindow(scope: DemandScope, page: unknown): WindowRead {
  const fail = (reason: string): WindowRead => ({ window: null, reason });
  if (!scopeValid(scope)) return fail('INVALID_SCOPE');
  const p = page as { items?: unknown; nextCursor?: unknown };
  if (!p || !Array.isArray(p.items) || p.items.length > 100) return fail('INVALID_OR_OVERSIZED_PAGE');
  const from = scope.observedAt - 300_000;
  const seen = new Set<string>(); const trades: ReportedTrade[] = [];
  for (const t of p.items) {
    if (!t || !address(t.trader) || !['buy', 'sell'].includes(t.side)
      || !finite(t.timestamp) || t.timestamp <= 0 || t.timestamp * 1000 > scope.observedAt
      || !finite(t.quoteAmount) || t.quoteAmount <= 0
      || typeof t.txHash !== 'string' || !/^0x[a-f0-9]{64}$/i.test(t.txHash)
      || typeof t.id !== 'string' || !/^0x[a-f0-9]{64}:\d{1,20}$/i.test(t.id)
      || t.id.slice(0, 66).toLowerCase() !== t.txHash.toLowerCase()) return fail('INVALID_TRADE');
    const id = t.txHash.toLowerCase() + ':' + BigInt(t.id.slice(67)).toString();
    if (seen.has(id)) return fail('DUPLICATE_TRADE');
    seen.add(id);
    trades.push({ id, wallet: t.trader.toLowerCase(), side: t.side, at: t.timestamp * 1000, quoteAmount: t.quoteAmount });
  }
  // A truncated page proves completeness only if sorted newest-to-oldest and
  // it reaches the start boundary. Otherwise older unseen rows can be missing.
  if (trades.some((t, i) => i > 0 && t.at > trades[i - 1].at)) return fail('UNORDERED_PAGE');
  if (p.nextCursor !== null && !(typeof p.nextCursor === 'string' && p.nextCursor.length > 0
    && trades.some(t => t.at <= from))) return fail('INCOMPLETE_WINDOW');
  return { reason: 'REPORTED_WINDOW_ONLY', window: { ...scope, token: scope.token.toLowerCase(), creator: scope.creator.toLowerCase(),
    venue: scope.venue.toLowerCase(), source: 'PONS_REPORTED', from, trades: trades.filter(t => t.at > from) } };
}

export function compareReportedDemand(first: DemandWindow, second: DemandWindow) {
  // Revalidate public typed input so callers cannot bypass parser constraints.
  const valid = (w: DemandWindow) => {
    if (!scopeValid(w) || w.source !== 'PONS_REPORTED' || w.from !== w.observedAt - 300_000
      || !Array.isArray(w.trades) || w.trades.length > 100 || w.trades.some(t => !t)) return false;
    const page = { nextCursor: null, items: w.trades.map(t => ({ id: t.id, txHash: t.id?.slice(0, 66), trader: t.wallet,
      side: t.side, timestamp: t.at / 1000, quoteAmount: t.quoteAmount })) };
    const read = readReportedDemandWindow(w, page);
    return Boolean(read.window && read.window.trades.length === w.trades.length);
  };
  if (!valid(first) || !valid(second)) throw Error('Invalid reported window');
  const normalize = (w: DemandWindow): DemandWindow => ({ ...w, creator: w.creator.toLowerCase(),
    trades: w.trades.map(t => ({ ...t, wallet: t.wallet.toLowerCase() })) });
  first = normalize(first); second = normalize(second);
  if (first.token.toLowerCase() !== second.token.toLowerCase() || first.creator.toLowerCase() !== second.creator.toLowerCase()
    || first.venue.toLowerCase() !== second.venue.toLowerCase()) throw Error('Token, creator or venue changed');
  if (second.from < first.observedAt || second.from > first.observedAt + 60_000) throw Error('Windows must be consecutive and non-overlapping (maximum 60s gap)');
  const summarize = (w: DemandWindow) => {
    const buys = w.trades.filter(t => t.side === 'buy' && t.wallet !== w.creator.toLowerCase());
    const sells = w.trades.filter(t => t.side === 'sell');
    const buyQuote = buys.reduce((sum, t) => sum + t.quoteAmount, 0);
    const sellQuote = sells.reduce((sum, t) => sum + t.quoteAmount, 0);
    if (!finite(buyQuote) || !finite(sellQuote)) throw Error('Amount overflow');
    return { reportedNonCreatorBuyWallets: new Set(buys.map(t => t.wallet)).size,
      reportedNonCreatorBuyQuote: buyQuote, reportedSellQuote: sellQuote,
      reportedSells: sells.length, reportedCreatorSells: sells.filter(t => t.wallet === w.creator.toLowerCase()).length };
  };
  const a = summarize(first), b = summarize(second);
  const priorBuyers = new Set(first.trades.filter(t => t.side === 'buy' && t.wallet !== first.creator.toLowerCase()).map(t => t.wallet));
  const repeated = new Set(second.trades.filter(t => t.side === 'buy' && t.wallet !== second.creator.toLowerCase() && priorBuyers.has(t.wallet)).map(t => t.wallet));
  return { mode: 'OFFLINE_SHADOW' as const, status: 'INSUFFICIENT_EVIDENCE' as const, eligibleForAlert: false as const,
    first: a, second: b, reportedRepeatBuyWallets: repeated.size,
    missing: ['CHAIN_VERIFIED_SWAPS', 'RELATED_WALLET_ASSESSMENT', 'BUYER_BALANCE_RETENTION',
      'CREATOR_DISTRIBUTION_COVERAGE', 'EXECUTABLE_EXIT_DEPTH', 'COMPARABLE_RETEST', 'LP_LOCK_STATUS'],
    caveats: ['Non-creator wallets are not established independent buyers.',
      'Repeat buys do not prove retained holdings.', 'No reported creator sale does not establish no distribution.',
      'Quote amounts are in the page quote asset, not USD.', 'Reported sells do not establish current sellability.'] };
}
