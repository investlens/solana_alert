export type VerifiedDataState = 'VERIFIED' | 'VERIFYING' | 'STALE' | 'UNAVAILABLE';

export type VerifiedData<T> = {
  state: VerifiedDataState;
  value: T | null;
  observedAt?: string | number | Date | null;
  provenance?: string | null;
};

export function finiteVerifiedNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

export function verifiedPercent(value: unknown): string | null {
  const numeric = finiteVerifiedNumber(value);
  return numeric == null ? null : `${Number(numeric.toFixed(2))}%`;
}

export function freshnessLabel(observedAt: string | number | Date | null | undefined, now = Date.now()): string | null {
  if (observedAt == null) return null;
  const timestamp = observedAt instanceof Date ? observedAt.getTime() : typeof observedAt === 'number' ? observedAt : Date.parse(observedAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now + 5_000) return null;
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export function dataStateLabel(state: VerifiedDataState): string {
  if (state === 'VERIFIED') return 'Verified';
  if (state === 'VERIFYING') return 'Verifying';
  if (state === 'STALE') return 'Stale';
  return 'Unavailable';
}

export function verifiedValue<T>(input: VerifiedData<T>): T | null {
  return input.state === 'VERIFIED' ? input.value : null;
}

export function evidenceState(value: unknown): VerifiedDataState {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'VERIFIED' || normalized === 'MEASURED') return 'VERIFIED';
  if (normalized === 'VERIFYING' || normalized === 'PENDING') return 'VERIFYING';
  if (normalized === 'STALE') return 'STALE';
  return 'UNAVAILABLE';
}
