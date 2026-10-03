export type DexPaidCheckOutcome = 'PROVIDER_UNAVAILABLE' | 'NO_PAID_ORDER' | 'PAYMENT_OUTSIDE_WINDOW' |
  'RETRY_COOLDOWN' | 'TELEGRAM_ACCEPTED' | 'NO_DELIVERY' | 'DELIVERY_FAILURE';
// Fixed buckets, no token/user IDs, no persistence or additional provider calls.
export function createDexPaidDiagnostics(emit: (summary: {windowSeconds: number; checks: number;
  outcomes: Partial<Record<DexPaidCheckOutcome, number>>}) => void, intervalMs = 300_000) {
  let started: number | null = null;
  let outcomes: Partial<Record<DexPaidCheckOutcome, number>> = {};
  let checks = 0;
  return (outcome: DexPaidCheckOutcome, now = Date.now()) => {
    started ??= now;
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    checks++;
    if (now - started >= intervalMs) {
      emit({windowSeconds: Math.round((now - started) / 1000), checks, outcomes: {...outcomes}});
      outcomes = {}; checks = 0; started = now;
    }
  };
}
export const recordDexPaidCheck = createDexPaidDiagnostics(summary => console.info('[DexPaidAudit] SUMMARY', summary));
