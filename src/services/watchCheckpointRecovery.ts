// No database writes. Failed recovery blocks checkpoint overwrite, not live
// discovery; the caller retries on its existing bounded checkpoint cadence.
export function watchCheckpointRecovery(restore: () => Promise<void>, save: () => Promise<void>, label: string) {
  let restored = false;
  let acknowledged = false;
  return async () => {
    if (!restored) {
      try { await restore(); restored = true; console.log(`[WatchCheckpoint] READY feed=${label}`); }
      catch (error) { console.warn(`[WatchCheckpoint] RETRY feed=${label} writesBlocked=true reason=${checkpointFailureReason(error)}`); return; }
    }
    try { await save(); if (!acknowledged) { acknowledged = true; console.log(`[WatchCheckpoint] SAVED feed=${label}`); } }
    catch (error) { console.warn(`[WatchCheckpoint] SAVE_RETRY feed=${label} reason=${checkpointFailureReason(error)}`); }
  };
}

export function checkpointFailureReason(error:unknown):string {
 const message=error instanceof Error?error.message:'';
 return /Invalid watch checkpoint/.test(message)?'INVALID_CHECKPOINT':/timeout|deadline/i.test(message)?'STORE_TIMEOUT':/unavailable/i.test(message)?'STORE_UNAVAILABLE':'RECOVERY_FAILED';
}
