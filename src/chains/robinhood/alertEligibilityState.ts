const socialState = new Map<string, { eligible: boolean; at: number }>();
export function recordLaunchSocialEligibility(token: string, eligible: boolean, now = Date.now()): void {
  if (socialState.size >= 500) socialState.delete(socialState.keys().next().value!);
  socialState.set(token.toLowerCase(), { eligible, at: now });
}
export function launchSocialEligibility(token: string, now = Date.now()): boolean | null {
  const value = socialState.get(token.toLowerCase());
  if (!value || now - value.at > 2 * 60 * 60_000) return null;
  return value.eligible;
}

export type BoostVerificationRetry = { total: number; firstAt: number; nextAt: number; attempts: number };
export function boostVerificationDue(retries: Map<string, BoostVerificationRetry>, token: string, total: number, now: number): boolean {
  const retry = retries.get(token.toLowerCase());
  return !retry || total > retry.total || now >= retry.nextAt;
}
export function recordBoostSecurityBlock(totals: Map<string, number>, retries: Map<string, BoostVerificationRetry>,
  token: string, total: number, unknownEvidence: boolean, now: number): 'RETRY_PENDING' | 'HARD_BLOCK' | 'RETRY_EXHAUSTED' {
  token = token.toLowerCase();
  const previous = retries.get(token);
  const retry = previous?.total === total ? previous : { total, firstAt: now, nextAt: now, attempts: 0 };
  if (!unknownEvidence || now - retry.firstAt >= 30 * 60_000) {
    totals.set(token, total); retries.delete(token);
    return unknownEvidence ? 'RETRY_EXHAUSTED' : 'HARD_BLOCK';
  }
  retry.attempts += 1;
  retry.nextAt = now + Math.min(5 * 60_000, retry.attempts * 60_000);
  if (retries.size >= 100 && !retries.has(token)) {
    const oldest = retries.keys().next().value!;
    const evicted = retries.get(oldest)!;
    totals.set(oldest, evicted.total); retries.delete(oldest);
  }
  retries.set(token, retry);
  return 'RETRY_PENDING';
}
