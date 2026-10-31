/** Offline Echo acceptance reconciliation. The caller transaction ledger must be
 * independently collected and marked complete; Telegram logs alone cannot prove coverage.
 * This module never makes RPC calls or sends alerts.
 */
export type VerifiedBuy = { caller: string; signature: string; mint: string; tradeAt: number };
export type TelegramBuy = { caller: string; signature: string; mint: string; messageId: number; deliveredAt: number };
export type ReferenceCoverage = { caller: string; complete: boolean; from: number; to: number };
export type EchoBuyReconciliation = {
  accepted: boolean; missing: VerifiedBuy[]; duplicateDeliveries: TelegramBuy[];
  unexpectedDeliveries: TelegramBuy[]; lateDeliveries: TelegramBuy[]; matched: number;
  incompleteCallers: string[];
};
const id = (r: {caller:string;signature:string;mint:string}) => [r.caller,r.signature,r.mint].join('|');
export function reconcileEchoBuys(
  expected: readonly VerifiedBuy[], delivered: readonly TelegramBuy[],
  coverage: readonly ReferenceCoverage[], maxDelaySeconds = 10
): EchoBuyReconciliation {
  if (!Number.isFinite(maxDelaySeconds) || maxDelaySeconds < 0) throw Error('INVALID_MAX_DELAY');
  const complete = new Map(coverage.map(c => [c.caller,c]));
  const callers = new Set([...expected.map(x=>x.caller),...delivered.map(x=>x.caller),...coverage.map(x=>x.caller)]);
  const incompleteCallers = [...callers].filter(c => {
    const e = complete.get(c);
    return !e || !e.complete || !Number.isFinite(e.from) || !Number.isFinite(e.to) || e.from >= e.to;
  });
  const expectedMap = new Map<string,VerifiedBuy>();
  for (const buy of expected) {
    if (!buy.signature || !buy.mint || !Number.isFinite(buy.tradeAt)) throw Error('INVALID_REFERENCE_BUY');
    if (expectedMap.has(id(buy))) throw Error('DUPLICATE_REFERENCE_BUY');
    expectedMap.set(id(buy),buy);
    const c = complete.get(buy.caller);
    if (!c || buy.tradeAt < c.from || buy.tradeAt > c.to) throw Error('BUY_OUTSIDE_COVERAGE');
  }
  const seen = new Set<string>(), duplicateDeliveries: TelegramBuy[] = [], unexpectedDeliveries: TelegramBuy[] = [];
  const lateDeliveries: TelegramBuy[] = [];
  for (const msg of delivered) {
    if (!Number.isSafeInteger(msg.messageId) || msg.messageId <= 0 || !Number.isFinite(msg.deliveredAt)) throw Error('INVALID_DELIVERY');
    const key = id(msg);
    if (seen.has(key)) duplicateDeliveries.push(msg);
    seen.add(key);
    const buy = expectedMap.get(key);
    if (!buy) unexpectedDeliveries.push(msg);
    else if (msg.deliveredAt < buy.tradeAt || msg.deliveredAt - buy.tradeAt > maxDelaySeconds) lateDeliveries.push(msg);
  }
  const missing = expected.filter(b => !seen.has(id(b)));
  const matched = expected.length - missing.length;
  return { accepted: incompleteCallers.length === 0 && missing.length === 0 && duplicateDeliveries.length === 0 &&
    unexpectedDeliveries.length === 0 && lateDeliveries.length === 0 && callers.size > 0,
    missing, duplicateDeliveries, unexpectedDeliveries, lateDeliveries, matched, incompleteCallers };
}
