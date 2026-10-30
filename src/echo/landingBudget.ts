/** Offline, deterministic fee guard for Echo's future paper/approved execution path.
 * Does not sign, send, or authorize any transaction. */
export const MAX_ECHO_PRIORITY_FEE_LAMPORTS = 100_000; // 0.0001 SOL
export const MAX_ECHO_JITO_TIP_LAMPORTS = 100_000; // 0.0001 SOL
export const MAX_ECHO_COMBINED_LANDING_LAMPORTS = 150_000; // 0.00015 SOL
export type EchoLandingBudget = { computeUnitLimit: number; microLamportsPerCu: number; jitoTipLamports?: number };
export type EchoLandingDecision = { allowed: true; priorityFeeLamports: number; totalLandingLamports: number } |
  { allowed: false; reason: 'INVALID_FEE' | 'FEE_CAP_EXCEEDED' };
export function validateEchoLandingBudget(input: EchoLandingBudget): EchoLandingDecision {
  const { computeUnitLimit, microLamportsPerCu } = input;
  const tip = input.jitoTipLamports ?? 0;
  if (!Number.isSafeInteger(computeUnitLimit) || computeUnitLimit < 1 || computeUnitLimit > 1_400_000 ||
      !Number.isSafeInteger(microLamportsPerCu) || microLamportsPerCu < 0 ||
      !Number.isSafeInteger(tip) || tip < 0) return { allowed: false, reason: 'INVALID_FEE' };
  const priorityFeeLamports = Math.ceil(computeUnitLimit * microLamportsPerCu / 1_000_000);
  const totalLandingLamports = priorityFeeLamports + tip;
  if (!Number.isSafeInteger(priorityFeeLamports) || priorityFeeLamports > MAX_ECHO_PRIORITY_FEE_LAMPORTS ||
      tip > MAX_ECHO_JITO_TIP_LAMPORTS || totalLandingLamports > MAX_ECHO_COMBINED_LANDING_LAMPORTS)
    return { allowed: false, reason: 'FEE_CAP_EXCEEDED' };
  return { allowed: true, priorityFeeLamports, totalLandingLamports };
}
