import bs58 from 'bs58';
import type { ParsedTransactionWithMeta } from '@solana/web3.js';
import { ECHO_WALLETS, type EchoSignal } from './signals.js';

/** Fail-closed Pump.fun mobile-app router classifier.
 * Evidence: Chairman's confirmed USDC buy 468XdziMPaFGnTZxC5tq66bRRxfVbNo5DuhEWaFMskiGexo4fkn8M2zg4KRZvn6E5rsAQYCtCYSMWsvgAUCb4P6U
 * Router discriminator and 68-byte data length were observed on chain.
 * Scope deliberately limited to the evidenced USDC-funded buy form. Unknown
 * router tags, SOL-funded routes, SELLs and transfers remain unclassified.
 */
export const PUMP_APP_ROUTER = '6Vo3245eszAb5wuqEMw8mGdbfRUdKbHhDHP5LcaGuTAB';
export const PUMP_APP_USDC_BUY_TAG = 'e034828d490a71c5';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = 'So11111111111111111111111111111111111111112';
const key = (value: any): string => typeof value === 'string' ? value : value?.toBase58?.() ?? '';
type Delta = { decimals: number; raw: bigint };
function ownerTokenDeltas(tx: ParsedTransactionWithMeta, wallet: string): Map<string, Delta> | null {
  const deltas = new Map<string, Delta>();
  for (const [sign, rows] of [
    [-1n, tx.meta?.preTokenBalances ?? []],
    [1n, tx.meta?.postTokenBalances ?? []]
  ] as const) {
    for (const row of rows) {
      if (row.owner !== wallet) continue;
      const {amount, decimals} = row.uiTokenAmount;
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.mint) ||
          !/^\d+$/.test(amount) || !Number.isInteger(decimals) ||
          decimals < 0 || decimals > 18) return null;
      const previous = deltas.get(row.mint);
      if (previous && previous.decimals !== decimals) return null;
      deltas.set(row.mint, {
        decimals, raw: (previous?.raw ?? 0n) + sign * BigInt(amount)
      });
    }
  }
  return deltas;
}
export function extractPumpAppRoutedEchoBuys(
  tx: ParsedTransactionWithMeta | null, signature: string, now: number
): EchoSignal[] {
  if (!tx?.meta || tx.meta.err !== null || tx.transaction.signatures[0] !== signature ||
      !Number.isFinite(tx.blockTime) || tx.blockTime! <= 0 ||
      tx.blockTime! > now + 15 || now - tx.blockTime! > 1800) return [];
  // Only the exactly observed Pump App router instruction shape is accepted.
  const routed = (tx.transaction.message.instructions ?? []).filter(ix => key(ix.programId) === PUMP_APP_ROUTER);
  if (routed.length !== 1 || !('data' in routed[0]) || typeof routed[0].data !== 'string') return [];
  let data: Uint8Array;
  try { data = bs58.decode(routed[0].data); } catch { return []; }
  if (data.length !== 68 || Buffer.from(data.subarray(0, 8)).toString('hex') !== PUMP_APP_USDC_BUY_TAG) return [];

  const accounts = tx.transaction.message.accountKeys;
  const results: EchoSignal[] = [];
  for (const [wallet, caller] of Object.entries(ECHO_WALLETS)) {
    if (!accounts.some(account => account.signer === true && key(account.pubkey) === wallet)) continue;
    const deltas = ownerTokenDeltas(tx, wallet);
    if (!deltas) continue;
    const nonzero = [...deltas].filter(([,d]) => d.raw !== 0n);
    // One and only one USDC debit plus one token credit; nothing else.
    if (nonzero.length !== 2) continue;
    const spent = deltas.get(USDC);
    const credits = nonzero.filter(([mint, d]) => mint !== USDC && mint !== SOL && d.raw > 0n);
    if (!spent || spent.raw >= 0n || credits.length !== 1) continue;
    const [mint, received] = credits[0];
    if (!nonzero.every(([m]) => m === USDC || m === mint)) continue;
    const quoteAmount = Number(-spent.raw) / 10 ** spent.decimals;
    const tokenAmount = Number(received.raw) / 10 ** received.decimals;
    if (!Number.isFinite(quoteAmount) || quoteAmount <= 0 ||
        !Number.isFinite(tokenAmount) || tokenAmount <= 0) continue;
    results.push({
      id: signature + ':' + wallet + ':' + mint + ':BUY',
      wallet, caller, signature, timestamp: tx.blockTime!, mint, side: 'BUY',
      tokenAmount, quoteAmount, quoteMint: USDC, quoteSymbol: 'USDC',
      quoteBasis: 'token-account net change'
    });
  }
  return results;
}
