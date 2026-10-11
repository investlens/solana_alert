// Presentation only. Missing proof must never become an unlocked/locked claim.
export function lpLockNote(status?: string | null, preBond = false): string {
  if (preBond) return 'LP lock: <b>Not applicable · bonding curve</b>';
  const value = status?.trim();
  if (/^UNLOCKED$/i.test(value ?? '')) return '⚠️ LP lock: <b>Unlocked</b>';
  if (/^LOCKED$/i.test(value ?? '')) return 'LP lock: <b>Locked</b>';
  if (/^BURNED$/i.test(value ?? '')) return 'LP lock: <b>Burned</b>';
  return '⚠️ LP lock: <b>Unable to verify</b>';
}
