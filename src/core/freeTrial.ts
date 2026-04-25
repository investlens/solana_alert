import type { FreeTrialInfo } from '../types.js';

const TRIAL_HOURS = 48;

function getTrialStart() {
  // bot launch / user first use reference
  // if you later store per-user created_at in Supabase,
  // replace this with user's signup time.
  return globalThis.__alphaTrialStartedAt ??
    (globalThis.__alphaTrialStartedAt = Date.now());
}

function hoursRemaining(startMs: number) {
  const ends = startMs + TRIAL_HOURS * 60 * 60 * 1000;
  return Math.max(
    0,
    Math.ceil((ends - Date.now()) / (1000 * 60 * 60))
  );
}

export function getFreeTrialInfo(): FreeTrialInfo {

  const startedAt = getTrialStart();

  const trialEndsAt =
    startedAt + TRIAL_HOURS * 60 * 60 * 1000;

  const premiumTrialActive =
    Date.now() < trialEndsAt;

  return {
    used: premiumTrialActive ? 1 : 0, // legacy compatibility
    limit: 1,                         // legacy compatibility

    // during trial user gets premium-speed alerts
    fastDelayActive: premiumTrialActive,

    // instant during trial
    freeDelaySec: premiumTrialActive
      ? 0
      : 300,

    // extra metadata for future UI
    trialHoursRemaining:
      hoursRemaining(startedAt),

    premiumTrialActive,
  } as FreeTrialInfo & {
    trialHoursRemaining: number;
    premiumTrialActive: boolean;
  };
}

export function consumeFreeTrialAlert(): FreeTrialInfo {
  // no per-alert consumption anymore
  return getFreeTrialInfo();
}