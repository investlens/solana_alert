import bs58 from 'bs58';
import type { ParsedTransactionWithMeta } from '@solana/web3.js';
import { ECHO_WALLETS, SOL_MINT, type EchoSignal } from './signals.js';

// Instruction layouts checked against pump-fun/pump-public-docs IDLs on
// 2026-10-21. Unknown programs, instructions and ambiguous trades fail closed.
export const ECHO_PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const ECHO_PUMP_SWAP = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const BUY = '66063d1201daebea', SELL = '33e685a4017f83ad';
const CURVE_EXACT_BUY = '38fc74089edfcd5f', AMM_EXACT_BUY = 'c62e1552b4d9e870';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const key = (value: any): string => typeof value === 'string' ? value : value?.toBase58?.() ?? '';
type Balance = NonNullable<NonNullable<ParsedTransactionWithMeta['meta']>['preTokenBalances']>[number];
function tokenBalance(pre: Balance[], post: Balance[], index: number, mint: string, owner: string) {
  const before = pre.find(x => x.accountIndex === index), after = post.find(x => x.accountIndex === index);
  if (!before && !after) return null;
  for (const value of [before, after].filter(Boolean)) {
    if (value!.owner !== owner || value!.mint !== mint || !/^\d+$/.test(value!.uiTokenAmount.amount) ||
        !Number.isInteger(value!.uiTokenAmount.decimals) || value!.uiTokenAmount.decimals < 0 || value!.uiTokenAmount.decimals > 18) return null;
  }
  const decimals = (after ?? before)!.uiTokenAmount.decimals;
  if (before && after && before.uiTokenAmount.decimals !== after.uiTokenAmount.decimals) return null;
  const delta = BigInt(after?.uiTokenAmount.amount ?? '0') - BigInt(before?.uiTokenAmount.amount ?? '0');
  const amount = Number(delta) / 10 ** decimals;
  return Number.isFinite(amount) ? amount : null;
}
export type EchoRejectReason = 'invalid_or_stale' | 'unsupported_program_or_instruction' | 'wallet_not_signer' | 'unsupported_quote' | 'unresolved_accounts' | 'ambiguous_or_unverified_balance';
// Pure, bounded diagnostics: no RPC calls, token data, wallet identifiers, or signatures in logs.
export function classifyEchoRejection(tx: ParsedTransactionWithMeta | null, signature: string, now: number): EchoRejectReason {
  if (!tx?.meta || tx.meta.err != null || tx.transaction.signatures[0] !== signature ||
      !Number.isFinite(tx.blockTime) || tx.blockTime! <= 0 || tx.blockTime! > now + 15 || now - tx.blockTime! > 120)
    return 'invalid_or_stale';
  const keys = tx.transaction.message.accountKeys;
  const instructions = [...tx.transaction.message.instructions, ...(tx.meta.innerInstructions ?? []).flatMap(x => x.instructions)];
  let matched = false, authorized = false, quoteOk = false, accountsOk = false;
  for (const ix of instructions) {
    if (!('data' in ix) || !('accounts' in ix)) continue;
    const program = key(ix.programId);
    if (program !== ECHO_PUMP && program !== ECHO_PUMP_SWAP) continue;
    let data: Uint8Array;
    try { data = bs58.decode(ix.data); } catch { continue; }
    const tag = Buffer.from(data.subarray(0, 8)).toString('hex');
    if (data.length < 24 || ![BUY, SELL, CURVE_EXACT_BUY, AMM_EXACT_BUY].includes(tag)) continue;
    matched = true;
    const curve = program === ECHO_PUMP, a = ix.accounts.map(key), wallet = a[curve ? 6 : 1];
    if (!ECHO_WALLETS[wallet] || !keys.some(k => k.signer && key(k.pubkey) === wallet)) continue;
    authorized = true;
    const mint = a[curve ? 2 : 3], quote = curve ? SOL_MINT : a[4];
    if (!mint || ![SOL_MINT, USDC].includes(quote) || [SOL_MINT, USDC].includes(mint)) continue;
    quoteOk = true;
    if (keys.some(k => key(k.pubkey) === a[5]) &&
        (curve || keys.some(k => key(k.pubkey) === a[6]))) accountsOk = true;
  }
  if (!matched) return 'unsupported_program_or_instruction';
  if (!authorized) return 'wallet_not_signer';
  if (!quoteOk) return 'unsupported_quote';
  if (!accountsOk) return 'unresolved_accounts';
  return 'ambiguous_or_unverified_balance';
}
export function extractRpcEchoSignals(tx: ParsedTransactionWithMeta | null, signature: string, now: number): EchoSignal[] {
  if (!tx?.meta || tx.meta.err != null || tx.transaction.signatures[0] !== signature || !Number.isFinite(tx.blockTime) ||
      tx.blockTime! <= 0 || tx.blockTime! > now + 15 || now - tx.blockTime! > 120) return [];
  const keys = tx.transaction.message.accountKeys;
  const instructions = [...tx.transaction.message.instructions, ...(tx.meta.innerInstructions ?? []).flatMap(x => x.instructions)];
  const candidates: Array<{ wallet: string; mint: string; quote: string; side: 'BUY' | 'SELL'; tokenIndex: number; quoteIndex: number }> = [];
  for (const ix of instructions) {
    if (!('data' in ix) || !('accounts' in ix)) continue;
    const program = key(ix.programId);
    if (![ECHO_PUMP, ECHO_PUMP_SWAP].includes(program)) continue;
    let data: Uint8Array;
    try { data = bs58.decode(ix.data); } catch { return []; }
    const tag = Buffer.from(data.subarray(0, 8)).toString('hex');
    const buy = tag === BUY || tag === (program === ECHO_PUMP ? CURVE_EXACT_BUY : AMM_EXACT_BUY);
    if (!buy && tag !== SELL) continue;
    if (data.length < 24) return [];
    const curve = program === ECHO_PUMP, a = ix.accounts.map(key);
    const wallet = a[curve ? 6 : 1], mint = a[curve ? 2 : 3], quote = curve ? SOL_MINT : a[4];
    if (!ECHO_WALLETS[wallet] || !keys.some(k => k.signer === true && key(k.pubkey) === wallet)) continue;
    if (!mint || ![SOL_MINT, USDC].includes(quote) || [SOL_MINT, USDC].includes(mint)) continue;
    const tokenIndex = keys.findIndex(k => key(k.pubkey) === a[5]);
    const quoteIndex = curve ? -1 : keys.findIndex(k => key(k.pubkey) === a[6]);
    if (tokenIndex < 0 || (!curve && quoteIndex < 0)) return [];
    candidates.push({ wallet, mint, quote, side: buy ? 'BUY' : 'SELL', tokenIndex, quoteIndex });
  }
  const results: EchoSignal[] = [];
  for (const c of candidates) {
    // Multiple trade legs for this wallet cannot be attributed to one token fill.
    if (candidates.filter(x => x.wallet === c.wallet).length !== 1) continue;
    const pre = tx.meta.preTokenBalances ?? [], post = tx.meta.postTokenBalances ?? [];
    const delta = tokenBalance(pre, post, c.tokenIndex, c.mint, c.wallet);
    if (delta == null || (c.side === 'BUY' ? delta <= 0 : delta >= 0)) continue;
    const quoteDelta = c.quoteIndex < 0 ? null : tokenBalance(pre, post, c.quoteIndex, c.quote, c.wallet);
    let quoteAmount: number | null = null;
    let quoteBasis: EchoSignal['quoteBasis'] = 'unavailable';
    if (quoteDelta != null && (c.side === 'BUY' ? quoteDelta < 0 : quoteDelta > 0)) {
      quoteAmount = Math.abs(quoteDelta); quoteBasis = 'token-account net change';
    } else if (c.quote === SOL_MINT) {
      const index = keys.findIndex(k => key(k.pubkey) === c.wallet);
      const before = tx.meta.preBalances[index], after = tx.meta.postBalances[index];
      if (Number.isSafeInteger(before) && Number.isSafeInteger(after)) {
        const nativeDelta = (after - before) / 1e9;
        if (c.side === 'BUY' ? nativeDelta < 0 : nativeDelta > 0) {
          quoteAmount = Math.abs(nativeDelta); quoteBasis = 'wallet SOL net change; includes fees/rent';
        }
      }
    }
    results.push({ id: `${signature}:${c.wallet}:${c.mint}:${c.side}`, wallet: c.wallet, caller: ECHO_WALLETS[c.wallet], signature,
      timestamp: tx.blockTime!, mint: c.mint, side: c.side, tokenAmount: Math.abs(delta), quoteAmount,
      quoteSymbol: c.quote === SOL_MINT ? 'SOL' : 'USDC', quoteBasis });
  }
  return results;
}
