export type SetupSample = { at: number; price: number; quoteDepth: number };
export type SetupTrend = { peak: number; low: number; previous: SetupSample | null; dip: boolean; confirmations: number; basePrice?: number; baseDepth?: number; rising?: number; setupKind?: 'RECOVERY' | 'BREAKOUT' };
export const emptySetupTrend = (): SetupTrend => ({ peak: 0, low: 0, previous: null, dip: false, confirmations: 0 });

// These are screening thresholds, not backtested profitability estimates.
export function advanceSetupTrend(state: SetupTrend, sample: SetupSample): boolean {
  if (![sample.at, sample.price, sample.quoteDepth].every(Number.isFinite) || sample.price <= 0 || sample.quoteDepth <= 0) return false;
  let previous = state.previous;
  if (previous && sample.at <= previous.at) return false;
  // A slow provider invalidates consecutive confirmation, not observed extrema.
  // Forgetting the peak here made a real earlier pullback invisible forever.
  if (previous && sample.at - previous.at > 150_000) {
    state.confirmations = 0; state.rising = 0; previous = null;
  }
  if (!previous) { state.basePrice = sample.price; state.baseDepth = sample.quoteDepth; state.rising = 0; }
  const priorPeak = state.peak;
  state.peak = Math.max(state.peak, sample.price);
  if (!state.dip && sample.price <= state.peak * 0.97) {
    state.dip = true; state.low = sample.price; state.confirmations = 0;
  }
  if (state.dip) {
    state.low = Math.min(state.low, sample.price);
    state.confirmations = previous && sample.at - previous.at >= 45_000
      && sample.price > previous.price && sample.quoteDepth > previous.quoteDepth
      ? state.confirmations + 1 : 0;
  }
  state.rising = previous && sample.at - previous.at >= 45_000 && sample.price > previous.price && sample.quoteDepth > previous.quoteDepth ? (state.rising ?? 0) + 1 : 0;
  state.previous = sample;
  const breakout = !state.dip && (state.rising ?? 0) >= 2 && sample.price > priorPeak && sample.price >= (state.basePrice ?? sample.price) * 1.03 && sample.quoteDepth >= (state.baseDepth ?? sample.quoteDepth) * 1.03;
  if (breakout) { state.low = state.basePrice ?? sample.price; state.setupKind = 'BREAKOUT'; return true; }
  state.setupKind = 'RECOVERY';
  return state.dip && state.confirmations >= 2 && sample.price >= state.low * 1.03;
}

export function creatorSetupVerdict(args: { status: string; holding: number | null; burned: number | null; moved: number | null; scannedAt: number }, now: number): 'ELIGIBLE' | 'DATA_UNAVAILABLE' | 'RISK_REJECTED' {
  if (args.status !== 'COMPLETE' || !Number.isFinite(args.scannedAt) || now < args.scannedAt || now - args.scannedAt > 90_000
    || args.moved == null || !Number.isFinite(args.moved)) return 'DATA_UNAVAILABLE';
  if (args.moved !== 0) return 'RISK_REJECTED';
  const validPositive = (v: number | null) => v != null && Number.isFinite(v) && v > 0 && v <= 100;
  if (validPositive(args.holding) || validPositive(args.burned)) return 'ELIGIBLE';
  if (args.holding == null || !Number.isFinite(args.holding) || args.burned == null || !Number.isFinite(args.burned)) return 'DATA_UNAVAILABLE';
  return 'RISK_REJECTED';
}
export function creatorSetupEligible(args: Parameters<typeof creatorSetupVerdict>[0], now: number): boolean {
  return creatorSetupVerdict(args, now) === 'ELIGIBLE';
}
