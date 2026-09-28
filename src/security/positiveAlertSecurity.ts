export type LaunchClassification = 'PONS' | 'CUSTOM';
export type VerifiedLiquidityState = 'LOCKED' | 'BURNED' | 'UNLOCKED' | 'UNKNOWN';

export type PositiveAlertSecurityDecision = {
  allowed: boolean;
  launchType: LaunchClassification;
  liquidityState: VerifiedLiquidityState;
  liquidityVerified: boolean;
  reason: string;
};

const POSITIVE_SEMANTIC_EVENT_TYPES = new Set([
  'BOOST',
  'DEX_PAID',
  'VOLUME_SURGE',
  'REIGNITION',
  'TREND_REVERSAL',
  'RUNNER',
  'BREAKOUT',
  'PONS_PROVEN_DEV_LAUNCH',
  'PROVEN_DEV_LAUNCH',
]);

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizedState(value: unknown): VerifiedLiquidityState {
  const state = String(value ?? 'UNKNOWN').trim().toUpperCase();
  return state === 'LOCKED' || state === 'BURNED' || state === 'UNLOCKED'
    ? state
    : 'UNKNOWN';
}

export function isPositiveSemanticEvent(type: string): boolean {
  return POSITIVE_SEMANTIC_EVENT_TYPES.has(String(type ?? '').trim().toUpperCase());
}

export function readVerifiedLiquidityEvidence(raw: Record<string, unknown> | null | undefined): {
  state: VerifiedLiquidityState;
  verified: boolean;
} {
  const data = raw ?? {};
  const nested = record(data.liquiditySafety) ?? record(data.lpSecurity) ?? record(data.liquiditySecurity);
  const state = normalizedState(
    data.liquiditySafetyStatus ??
    data.lpStatus ??
    data.lpLiquidityStatus ??
    nested?.status ??
    nested?.state,
  );
  const verified = (
    data.liquiditySafetyVerified === true ||
    data.lpStatusVerified === true ||
    data.lpVerified === true ||
    nested?.verified === true
  );
  return { state, verified };
}

function isSecurityRoutedBoost(raw: Record<string, unknown> | null | undefined): boolean {
  const data = raw ?? {};
  const canonical = String(data.canonicalEventType ?? '').trim().toUpperCase();
  const total = Number(data.boostTotal);
  return /^BOOST_(?:DETECTED|INCREASED)$/.test(canonical) || canonical === 'MAX_BOOST_500_PLUS'
    ? Number.isFinite(total) && total > 0
    : false;
}

export function evaluatePositiveAlertSecurity(args: {
  launchType: LaunchClassification;
  raw?: Record<string, unknown> | null;
}): PositiveAlertSecurityDecision {
  if (args.launchType === 'PONS') {
    return {
      allowed: true,
      launchType: 'PONS',
      liquidityState: 'UNKNOWN',
      liquidityVerified: false,
      reason: 'PONS_EXISTING_SECURITY_PATH',
    };
  }

  const evidence = readVerifiedLiquidityEvidence(args.raw);
  const routedBoost = isSecurityRoutedBoost(args.raw);
  const lockedOrBurned = evidence.verified && (evidence.state === 'LOCKED' || evidence.state === 'BURNED');
  // BOOST candidates reach this layer only after the dedicated BOOST security router.
  // For that event family, a known UNLOCKED LP is warning-level evidence rather than
  // a second hard block. Unknown LP evidence remains fail-closed, and all non-BOOST
  // positive semantic events keep the strict locked/burned requirement.
  const warnedUnlockedBoost = routedBoost && evidence.state === 'UNLOCKED';
  const allowed = lockedOrBurned || warnedUnlockedBoost;
  return {
    allowed,
    launchType: 'CUSTOM',
    liquidityState: evidence.state,
    liquidityVerified: evidence.verified,
    reason: lockedOrBurned
      ? `CUSTOM_LP_${evidence.state}_VERIFIED`
      : warnedUnlockedBoost
        ? 'CUSTOM_BOOST_LP_UNLOCKED_WARN_ALLOWED'
        : evidence.verified
          ? `CUSTOM_LP_${evidence.state}_BLOCKED`
          : 'CUSTOM_LP_UNVERIFIED_FAIL_CLOSED',
  };
}

export function labelLaunchType(message: string, launchType: LaunchClassification): string {
  const label = `🧭 Launch: <b>${launchType}</b>`;
  if (message.includes('🧭 Launch:')) return message;
  const firstBreak = message.indexOf('\n');
  return firstBreak < 0
    ? `${message}\n${label}`
    : `${message.slice(0, firstBreak)}\n${label}${message.slice(firstBreak)}`;
}
