/** A fresh-scan frontier is independent from the older archive pagination cursor.
 * Never advance the checkpoint until the scan has reached the previous checkpoint.
 */
export type FreshScanState = { checkpoint: string | null; before: string | null; candidate: string | null };
export type SignatureRow = { signature?: string; blockTime?: number | null; err?: unknown };
export function advanceFreshScan(state: FreshScanState, rows: SignatureRow[], pageLimit = 100):
 { state: FreshScanState; complete: boolean; scanned: SignatureRow[] } {
  if (pageLimit < 1) throw new Error('Invalid page limit');
  if (!Array.isArray(rows)) throw new Error('Signature page unavailable');
  const candidate = state.candidate ?? rows[0]?.signature ?? null;
  const boundary = state.checkpoint ? rows.findIndex(row => row.signature === state.checkpoint) : -1;
  const scanned = boundary >= 0 ? rows.slice(0, boundary) : rows;
  const complete = boundary >= 0 || rows.length < pageLimit;
  const last = rows.at(-1)?.signature;
  if (!complete && (!last || last === state.before)) throw new Error('Signature pagination stalled');
  return {
   state: complete ? { checkpoint: candidate, before: null, candidate: null } :
    { checkpoint: state.checkpoint, before: last!, candidate },
   complete, scanned
  };
}
