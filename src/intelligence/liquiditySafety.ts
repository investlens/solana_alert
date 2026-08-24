export type LiquiditySafetyStatus = 'LOCKED' | 'BURNED' | 'UNLOCKED' | 'UNKNOWN';
export type LiquiditySafetyEvidence = { status: LiquiditySafetyStatus; verified: boolean; source: string | null; observedAt: string; lockerOrBurnDestination: string | null; lockExpiresAt: string | null; reason: string };
export function assessLiquiditySafety(args: { chain: string; poolType: 'ERC20_LP' | 'CONCENTRATED_LIQUIDITY' | 'PONS_CURVE' | 'UNKNOWN'; lpOwnerVerified?: boolean; ownerIsCreatorOrTeam?: boolean; verifiedBurnDestination?: string | null; verifiedLocker?: string | null; verifiedLockExpiresAt?: string | null; source?: string | null; observedAt?: string }): LiquiditySafetyEvidence {
  const base = { source: args.source ?? null, observedAt: args.observedAt ?? new Date().toISOString(), lockerOrBurnDestination: null, lockExpiresAt: null };
  if (args.poolType === 'PONS_CURVE') return { ...base, status: 'UNKNOWN', verified: false, reason: 'PONS curve liquidity is not an ERC20 LP lock.' };
  if (args.poolType !== 'ERC20_LP') return { ...base, status: 'UNKNOWN', verified: false, reason: 'This pool type has no supported fungible LP-lock proof.' };
  if (args.lpOwnerVerified && args.verifiedBurnDestination) return { ...base, status: 'BURNED', verified: true, lockerOrBurnDestination: args.verifiedBurnDestination, reason: 'Verified LP ownership is irrecoverably burned under the supported mechanism.' };
  if (args.lpOwnerVerified && args.verifiedLocker) return { ...base, status: 'LOCKED', verified: true, lockerOrBurnDestination: args.verifiedLocker, lockExpiresAt: args.verifiedLockExpiresAt ?? null, reason: 'Verified LP ownership is held by a recognized lock mechanism.' };
  if (args.lpOwnerVerified && args.ownerIsCreatorOrTeam) return { ...base, status: 'UNLOCKED', verified: true, reason: 'Verified creator/team control of the LP position remains.' };
  return { ...base, status: 'UNKNOWN', verified: false, reason: 'Evidence is insufficient to establish LP control or lock status.' };
}
