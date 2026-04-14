import type { AuthorityInfo, AuthoritySafetyResult } from '../types.js';

export function computeAuthoritySafetyScore(info: AuthorityInfo): AuthoritySafetyResult {
  let score = 0;

  const reasonsGood: string[] = [];
  const reasonsWarn: string[] = [];
  const reasonsBad: string[] = [];

  const noData =
    info.mintAuthority === null &&
    info.freezeAuthority === null &&
    info.updateAuthority === null &&
    info.isMutable === null;

  if (noData) {
    return {
      authoritySafetyScore: 0,
      authoritySafetyLabel: 'WATCH',
      reasonsGood: [],
      reasonsWarn: ['Authority data unavailable'],
      reasonsBad: [],
    };
  }

  // Mint authority
  if (info.mintAuthority == null) {
    score += 40;
    reasonsGood.push('Mint authority revoked');
  } else {
    reasonsBad.push('Mint authority still active');
  }

  // Freeze authority
  if (info.freezeAuthority == null) {
    score += 30;
    reasonsGood.push('Freeze authority revoked');
  } else {
    reasonsWarn.push('Freeze authority still active');
  }

  // Update authority / mutability
  if (info.isMutable === false) {
    score += 20;
    reasonsGood.push('Metadata immutable');
  } else if (info.isMutable === true) {
    reasonsWarn.push('Metadata can still change');
  } else if (info.updateAuthority == null) {
    score += 15;
    reasonsGood.push('Update authority cleared');
  } else {
    reasonsWarn.push('Update authority still present');
  }

  score = Math.max(0, Math.min(100, score));

  let authoritySafetyLabel: AuthoritySafetyResult['authoritySafetyLabel'] = 'RISK';
  if (score >= 75) authoritySafetyLabel = 'GOOD';
  else if (score >= 40) authoritySafetyLabel = 'WATCH';

  return {
    authoritySafetyScore: score,
    authoritySafetyLabel,
    reasonsGood,
    reasonsWarn,
    reasonsBad,
  };
}