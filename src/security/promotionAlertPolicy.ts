export const PROMOTION_POLICY_VERSION = '2026-10-13.1';
export type PromotionLp = 'LOCKED' | 'BURNED' | 'UNLOCKED' | 'UNKNOWN';
export function reportedPromotionSells(pair: any): number | null {
  const values = ['m5', 'h1', 'h6', 'h24'].map(window => pair?.txns?.[window]?.sells)
    .filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0);
  return values.length ? Math.max(...values) : null;
}
export function promotionLiquidityWarning(status: PromotionLp): string {
  if (status === 'LOCKED' || status === 'BURNED') return `LP ${status.toLowerCase()} verified · trading risks remain.`;
  return status === 'UNLOCKED'
    ? '⚠️ LIQUIDITY NOT LOCKED — the owner can withdraw liquidity. High rug risk.'
    : '⚠️ LP LOCK NOT VERIFIED — liquidity protection is unknown. High rug risk.';
}
export function promotionAlertPolicy(args: { verifiedPons?: boolean; hardBlocked?: boolean; sells: number | null;
  exitVerified: boolean; lpStatus?: PromotionLp }) {
  const lpStatus = args.lpStatus ?? 'UNKNOWN';
  if (args.verifiedPons) return { allowed: true, watch: false, reason: 'Verified PONS origin · immediate promotion alert', lpStatus };
  if (args.hardBlocked) return { allowed: false, watch: false, reason: 'Confirmed honeypot or sell restriction', lpStatus };
  if (args.sells == null || args.sells < 1) return { allowed: false, watch: true,
    reason: 'WATCH: no confirmed sell activity; this alone does not prove a honeypot', lpStatus };
  if (!args.exitVerified) return { allowed: false, watch: true, reason: 'WATCH: selling remains unverified', lpStatus };
  return { allowed: true, watch: false, reason: promotionLiquidityWarning(lpStatus), lpStatus };
}
