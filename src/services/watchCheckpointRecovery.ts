// No database writes. Failed recovery blocks checkpoint overwrite, not live
// discovery; the caller retries on its existing bounded checkpoint cadence.
export function watchCheckpointRecovery(restore: () => Promise<void>, save: () => Promise<void>, label: string) {
  let restored = false;
  let acknowledged = false;
  return async () => {
    if (!restored) {
      try { await restore(); restored = true; console.log(`[WatchCheckpoint] READY feed=${label}`); }
      catch { console.warn(`[WatchCheckpoint] RETRY feed=${label} writesBlocked=true`); return; }
    }
    try { await save(); if (!acknowledged) { acknowledged = true; console.log(`[WatchCheckpoint] SAVED feed=${label}`); } }
    catch { console.warn(`[WatchCheckpoint] SAVE_RETRY feed=${label}`); }
  };
}
