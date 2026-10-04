export type LaunchClassification = 'PONS' | 'FLAP' | 'CUSTOM' | 'UNKNOWN';
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
  if (args.launchType === 'PONS' || args.launchType === 'FLAP') {
    return {
      allowed: true,
      launchType: args.launchType,
      liquidityState: 'UNKNOWN',
      liquidityVerified: false,
      reason: `${args.launchType}_EXISTING_SECURITY_PATH`,
    };
  }

  const evidence = readVerifiedLiquidityEvidence(args.raw);
  const routedBoost = isSecurityRoutedBoost(args.raw);
  const lockedOrBurned = evidence.verified && (evidence.state === 'LOCKED' || evidence.state === 'BURNED');
  // CUSTOM and UNKNOWN both use the conservative custom-token security path.
  // UNKNOWN only means provenance could not be proven at this moment; it never
  // weakens the liquidity/honeypot safety requirements.
  const warnedUnlockedBoost = routedBoost && evidence.state === 'UNLOCKED';
  const allowed = lockedOrBurned || warnedUnlockedBoost;
  const prefix = args.launchType === 'UNKNOWN' ? 'UNKNOWN_PROVENANCE' : 'CUSTOM';
  return {
    allowed,
    launchType: args.launchType,
    liquidityState: evidence.state,
    liquidityVerified: evidence.verified,
    reason: lockedOrBurned
      ? `${prefix}_LP_${evidence.state}_VERIFIED`
      : warnedUnlockedBoost
        ? `${prefix}_BOOST_LP_UNLOCKED_WARN_ALLOWED`
        : evidence.verified
          ? `${prefix}_LP_${evidence.state}_BLOCKED`
          : `${prefix}_LP_UNVERIFIED_FAIL_CLOSED`,
  };
}

export function labelLaunchType(message: string, launchType: LaunchClassification): string {
  const display = launchType === 'UNKNOWN' ? 'VERIFYING' : launchType;
  const label = `🧭 Launch: <b>${display}</b>`;
  if (message.includes('🧭 Launch:')) return message;
  const firstBreak = message.indexOf('\n');
  return firstBreak < 0
    ? `${message}\n${label}`
    : `${message.slice(0, firstBreak)}\n${label}${message.slice(firstBreak)}`;
}
