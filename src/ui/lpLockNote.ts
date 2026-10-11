// Presentation only. Missing proof must never become an unlocked/locked claim.
export function lpLockNote(status?: string | null, preBond = false): string {
  if (preBond) return 'LP lock: <b>Not applicable · bonding curve</b>';
  const value = status?.trim();
  if (/^UNLOCKED$/i.test(value ?? '')) return '⚠️ LP lock: <b>Unlocked</b>\n<b>RISKY ALERT — LIQUIDITY NOT LOCKED</b>\nLiquidity can be withdrawn; you may lose your investment. Trade at your own risk.';
  if (/^LOCKED$/i.test(value ?? '')) return 'LP lock: <b>Locked</b>';
  if (/^BURNED$/i.test(value ?? '')) return 'LP lock: <b>Burned</b>';
  return '⚠️ LP lock: <b>Unable to verify</b>\n<b>RISKY ALERT — LP LOCK STATUS UNAVAILABLE</b>\nLiquidity protection is unverified. Trade at your own risk.';
}
