/** Bounded provider-specific 429 circuit breaker. Never retries a blocked provider
 * until its cooldown expires; the independently configured fallback can still work.
 */
export function echoRpc429CooldownMs(streak: number, retryAfter: string | null): number {
  if (!Number.isSafeInteger(streak) || streak < 1) throw new Error('INVALID_RATE_LIMIT_STREAK');
  const exp = Math.min(900_000, 60_000 * 2 ** Math.min(4, streak - 1));
  // Retry-After may be seconds or an HTTP-date. Reject malformed/negative hints.
  const seconds = retryAfter == null ? NaN : Number(retryAfter);
  const hinted = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 0;
  return Math.min(900_000, Math.max(exp, hinted));
}
