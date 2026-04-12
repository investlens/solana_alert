import type { FreeTrialInfo } from '../types.js';

const FREE_TRIAL_LIMIT = 5;

let freeAlertCount = 0;

export function getFreeTrialInfo(): FreeTrialInfo {
  const used = freeAlertCount;
  const fastDelayActive = used < FREE_TRIAL_LIMIT;

  return {
    used,
    limit: FREE_TRIAL_LIMIT,
    fastDelayActive,
    freeDelaySec: fastDelayActive ? 60 : 300,
  };
}

export function consumeFreeTrialAlert(): FreeTrialInfo {
  freeAlertCount += 1;
  return getFreeTrialInfo();
}