import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import type { ParsedTransactionWithMeta } from '@solana/web3.js';
import { ECHO_WALLETS, SOL_MINT, type EchoSignal } from './signals.js';

/** Conservative, read-only Jupiter v6 route parser.
 * Only an explicit Jupiter routing instruction, wallet signature, and a single
 * net asset debit + a single net token credit are accepted.
 * No transfers, gifts or unrelated Jupiter account setup produce a BUY.
 */
const JUPITER_V6 = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ROUTE_NAMES = [
  'route',
  'route_with_token_ledger',
  'exact_out_route',
  'shared_accounts_route',
  'shared_accounts_route_with_token_ledger',
  'shared_accounts_exact_out_route',
] as const;
const ROUTE_TAGS = new Set(ROUTE_NAMES.map(name =>
  createHash('sha256').update('global:' + name).digest('hex').slice(0, 16)));
const key = (x: any): string => typeof x === 'string' ? x : x?.toBase58?.() ?? '';

type Delta = { raw: bigint; decimals: number };

function tokenDeltas(tx: ParsedTransactionWithMeta, wallet: string): Map<string, Delta> | null {
  const result = new Map<string, Delta>();
  for (const [side, rows] of [
    [-1n, tx.meta?.preTokenBalances ?? []],
    [1n, tx.meta?.postTokenBalances ?? []],
  ] as const) {
    for (const row of rows) {
      if (row.owner !== wallet) continue;
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.mint) ||
          !/^\d+$/.test(row.uiTokenAmount.amount) ||
          !Number.isInteger(row.uiTokenAmount.decimals) ||
          row.uiTokenAmount.decimals < 0 || row.uiTokenAmount.decimals > 18) return null;
      const old = result.get(row.mint);
      if (old && old.decimals !== row.uiTokenAmount.decimals) return null;
      result.set(row.mint, {
        decimals: row.uiTokenAmount.decimals,
        raw: (old?.raw ?? 0n) + side * BigInt(row.uiTokenAmount.amount),
      });
    }
  }
  return result;
}

export function extractJupiterRoutedEchoBuys(
  tx: ParsedTransactionWithMeta | null, signature: string, now: number,
): EchoSignal[] {
  if (!tx?.meta || tx.meta.err != null || tx.transaction.signatures[0] !== signature ||
      !Number.isFinite(tx.blockTime) || tx.blockTime! <= 0 ||
      tx.blockTime! > now + 15 || now - tx.blockTime! > 1800) return [];
  const instructions = tx.transaction.message.instructions ?? [];
  let verifiedRoutes = 0;
  for (const ix of instructions) {
    if (!('data' in ix) || key(ix.programId) !== JUPITER_V6) continue;
    let data: Uint8Array;
    try { data = bs58.decode(ix.data); } catch { return []; }
    if (data.length >= 8 && ROUTE_TAGS.has(Buffer.from(data.subarray(0, 8)).toString('hex')))
      verifiedRoutes++;
  }
  // Avoid multi-operation ambiguity: exactly one Jupiter route for this signature.
  if (verifiedRoutes !== 1) return [];

  const keys = tx.transaction.message.accountKeys;
  const results: EchoSignal[] = [];
  for (const [wallet, caller] of Object.entries(ECHO_WALLETS)) {
    const signer = keys.findIndex(x => x.signer && key(x.pubkey) === wallet);
    if (signer < 0) continue;
    const delta = tokenDeltas(tx, wallet);
    if (!delta) continue;
    const debits = [...delta].filter(([, value]) => value.raw < 0n);
    const credits = [...delta].filter(([mint, value]) =>
      value.raw > 0n && mint !== SOL_MINT && mint !== USDC);
    if (credits.length !== 1 || debits.length > 1) continue;
    const [mint, received] = credits[0];
    if (debits.length === 1 && debits[0][0] === mint) continue;

    let quoteMint = SOL_MINT;
    let quoteAmount: number;
    let quoteBasis: EchoSignal['quoteBasis'] = 'wallet SOL net change; includes fees/rent';
    if (debits.length === 1) {
      quoteMint = debits[0][0];
      quoteAmount = Number(-debits[0][1].raw) / 10 ** debits[0][1].decimals;
      quoteBasis = 'token-account net change';
    } else {
      // Only count a SOL-funded route when wallet actually spent lamports.
      const before = tx.meta.preBalances[signer], after = tx.meta.postBalances[signer];
      if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after) || before <= after) continue;
      quoteAmount = (before - after) / 1e9;
      // Exclude fees-only SOL deltas; routing instruction plus positive token balance required.
      if (quoteAmount <= 0.0001) continue;
    }
    const tokenAmount = Number(received.raw) / 10 ** received.decimals;
    if (!Number.isFinite(quoteAmount) || quoteAmount <= 0 ||
        !Number.isFinite(tokenAmount) || tokenAmount <= 0) continue;
    results.push({
      id: signature + ':' + wallet + ':' + mint + ':BUY',
      wallet, caller, signature, timestamp: tx.blockTime!, mint,
      side: 'BUY', tokenAmount, quoteAmount, quoteMint, quoteBasis,
      quoteSymbol: quoteMint === SOL_MINT ? 'SOL' : quoteMint === USDC ? 'USDC' : 'SPL',
    });
  }
  return results;
}
