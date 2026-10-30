/**
 * Cheap prefilter for Solana logsSubscribe messages.
 *
 * logsSubscribe(mentions: wallet) also produces notifications when a wallet is
 * merely named, for unsolicited transfers, rent, and non-trading instructions.
 * We only fetch full transactions when a known trading program was executed.
 * Unknown/missing log formats pass through for auditing rather than being silently lost.
 */
const TRADING_PROGRAM_IDS = new Set([
  // Pump.fun curve and PumpSwap.
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
  // Jupiter v6 route and common direct DEX routes.
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
  'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG',
  'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN',
  'BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi'
]);
const INVOCATION = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke \[\d+\]$/;

/** Filters obvious non-swap traffic, not a positive classification of a BUY. */
export function mayContainWalletSwap(logs: unknown): boolean {
  if (!Array.isArray(logs) || logs.length === 0) return true;
  for (const line of logs) {
    if (typeof line !== 'string') return true; // Unrecognized data: fail open.
    const invoked = INVOCATION.exec(line);
    if (invoked && TRADING_PROGRAM_IDS.has(invoked[1])) return true;
    // Unknown DEX programs may still use standard Anchor swap instruction logs.
    // Fetch for full signer/balance validation; never trust text as BUY proof.
    if (/^Program log: Instruction: (Buy|BuyExactIn|Swap|SwapBaseIn|SwapBaseOut|Route|ExactOutRoute|SharedAccountsRoute)\b/i.test(line)) return true;
  }
  return false;
}
