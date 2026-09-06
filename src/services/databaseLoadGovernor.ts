export type DatabaseWorkClass = 'CRITICAL' | 'BACKGROUND';

type GovernorState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

type GovernorSnapshot = {
  state: GovernorState;
  consecutiveFailures: number;
  openUntil: number;
  activeBackground: number;
};

const FAILURE_THRESHOLD = 3;
const BASE_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 10 * 60_000;
const MAX_BACKGROUND_CONCURRENCY = 1;

let state: GovernorState = 'CLOSED';
let consecutiveFailures = 0;
let openUntil = 0;
let activeBackground = 0;

export function isTransientDatabaseError(error: unknown): boolean {
  const value = error as { code?: unknown; status?: unknown; message?: unknown; details?: unknown } | null;
  const text = [value?.code, value?.status, value?.message, value?.details, error instanceof Error ? error.message : null]
    .filter(Boolean).join(' ').toLowerCase();
  return text.includes('pgrst002') || text.includes('pgrst003') || text.includes('503') || text.includes('504') ||
    text.includes('statement timeout') || text.includes('canceling statement') || text.includes('fetch failed') ||
    text.includes('connect timeout') || text.includes('connection timeout') || text.includes('schema cache');
}

function refreshState(now = Date.now()) {
  if (state === 'OPEN' && now >= openUntil) state = 'HALF_OPEN';
}

export function databaseGovernorSnapshot(now = Date.now()): GovernorSnapshot {
  refreshState(now);
  return { state, consecutiveFailures, openUntil, activeBackground };
}

export function canStartDatabaseWork(workClass: DatabaseWorkClass, now = Date.now()): boolean {
  if (workClass === 'CRITICAL') return true;
  refreshState(now);
  if (state === 'OPEN') return false;
  if (activeBackground >= MAX_BACKGROUND_CONCURRENCY) return false;
  if (state === 'HALF_OPEN' && activeBackground > 0) return false;
  return true;
}

export function recordDatabaseSuccess(workClass: DatabaseWorkClass) {
  if (workClass !== 'BACKGROUND') return;
  consecutiveFailures = 0;
  openUntil = 0;
  state = 'CLOSED';
}

export function recordDatabaseFailure(error: unknown, workClass: DatabaseWorkClass, now = Date.now()) {
  if (workClass !== 'BACKGROUND' || !isTransientDatabaseError(error)) return;
  consecutiveFailures += 1;
  if (consecutiveFailures < FAILURE_THRESHOLD && state !== 'HALF_OPEN') return;
  const exponent = Math.max(0, consecutiveFailures - FAILURE_THRESHOLD);
  const cooldown = Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** exponent);
  const jitter = Math.floor(cooldown * 0.2 * Math.random());
  state = 'OPEN';
  openUntil = now + cooldown + jitter;
}

export async function runDatabaseWork<T>(workClass: DatabaseWorkClass, fn: () => Promise<T>): Promise<T | null> {
  if (!canStartDatabaseWork(workClass)) return null;
  if (workClass === 'BACKGROUND') activeBackground += 1;
  try {
    const result = await fn();
    recordDatabaseSuccess(workClass);
    return result;
  } catch (error) {
    recordDatabaseFailure(error, workClass);
    throw error;
  } finally {
    if (workClass === 'BACKGROUND') activeBackground = Math.max(0, activeBackground - 1);
  }
}

export function resetDatabaseGovernorForTests() {
  state = 'CLOSED';
  consecutiveFailures = 0;
  openUntil = 0;
  activeBackground = 0;
}
