/** A fresh-scan frontier is independent from the older archive pagination cursor.
 * Never advance the checkpoint until the scan has reached the previous checkpoint.
 */
export type FreshScanState = { checkpoint: string | null; before: string | null; candidate: string | null; olderGapPending?: boolean };
export type SignatureRow = { signature?: string; blockTime?: number | null; err?: unknown };
export function advanceFreshScan(state: FreshScanState, rows: SignatureRow[], pageLimit = 100, cutoffSeconds?: number):
 { state: FreshScanState; complete: boolean; scanned: SignatureRow[]; cutoffWithoutCheckpoint: boolean } {
  if (pageLimit < 1) throw new Error('Invalid page limit');
  if (!Array.isArray(rows)) throw new Error('Signature page unavailable');
  const candidate = state.candidate ?? rows[0]?.signature ?? null;
  const boundary = state.checkpoint ? rows.findIndex(row => row.signature === state.checkpoint) : -1;
  const boundaryRows = boundary >= 0 ? rows.slice(0, boundary) : rows;
  const scanned = cutoffSeconds === undefined ? boundaryRows :
    boundaryRows.filter(row => !Number.isFinite(row.blockTime) || row.blockTime! >= cutoffSeconds);
  // Rows without blockTime must be fetched and checked, never silently dropped.
  // For live alerts the scan may finish at a verified time boundary even
  // when older archive history has thousands of additional signatures.
  // Never trust missing or out-of-order block times to complete coverage.
  const timed = rows.every((row, i) => Number.isFinite(row.blockTime) &&
    row.blockTime! > 0 && (i === 0 || row.blockTime! <= rows[i - 1].blockTime!));
  const crossedCutoff = cutoffSeconds !== undefined && Number.isFinite(cutoffSeconds) &&
    timed && rows.length > 0 && rows[rows.length - 1].blockTime! < cutoffSeconds;
  // With an existing checkpoint, a time cutoff is NOT proof of contiguous coverage.
  // Continue bounded historical pagination until the real checkpoint or end-of-history.
  // The persisted flag lets the next pass use a reduced audit RPC budget.
  const cutoffWithoutCheckpoint = crossedCutoff && boundary < 0 && state.checkpoint !== null;
  const complete = boundary >= 0 || rows.length < pageLimit || (crossedCutoff && state.checkpoint === null);
  const last = rows.at(-1)?.signature;
  if (!complete && (!last || last === state.before)) throw new Error('Signature pagination stalled');
  return {
   state: complete ? { checkpoint: candidate, before: null, candidate: null, olderGapPending: false } :
    { checkpoint: state.checkpoint, before: last!, candidate,
      olderGapPending: Boolean(state.olderGapPending || cutoffWithoutCheckpoint) },
   complete, scanned, cutoffWithoutCheckpoint
  };
}
