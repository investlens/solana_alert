import bs58 from 'bs58';
import type { ParsedTransactionWithMeta } from '@solana/web3.js';
import { ECHO_WALLETS, type EchoSignal } from './signals.js';

/** Fail-closed Pump.fun mobile-app router classifier.
 * Evidence: Chairman's confirmed USDC buy 468XdziMPaFGnTZxC5tq66bRRxfVbNo5DuhEWaFMskiGexo4fkn8M2zg4KRZvn6E5rsAQYCtCYSMWsvgAUCb4P6U
 * Router discriminator and 68-byte data length were observed on chain.
 * The distinct 82-byte native-SOL buy form was verified in Slingoor's
 * confirmed 2026-10-31 swap. Both accepted shapes require swap-specific
 * input spend plus a single owned token credit. Unknown routes remain denied.
 */
export const PUMP_APP_ROUTER = '6Vo3245eszAb5wuqEMw8mGdbfRUdKbHhDHP5LcaGuTAB';
export const PUMP_APP_USDC_BUY_TAG = 'e034828d490a71c5';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = 'So11111111111111111111111111111111111111112';
const SYSTEM = '11111111111111111111111111111111';
const TOKEN_PROGRAM='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const JUPITER_V6='JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
/** Only the precise observed 82-byte SOL-funded router shape. */
function verifiedNativeSolRouteInput(tx:ParsedTransactionWithMeta,wallet:string):number|null{
 const accountIndex=tx.transaction.message.accountKeys.findIndex(k=>k.signer===true&&key(k.pubkey)===wallet);
 if(accountIndex<0||!tx.meta)return null;
 const before=tx.meta.preBalances[accountIndex],after=tx.meta.postBalances[accountIndex];
 if(!Number.isSafeInteger(before)||!Number.isSafeInteger(after)||before<=after)return null;
 const inner=(tx.meta.innerInstructions??[]).flatMap(group=>group.instructions);
 if(!inner.some(ix=>key(ix.programId)===JUPITER_V6))return null;
 const direct=inner.filter(ix=>key(ix.programId)===SYSTEM&&
   'parsed' in ix && ix.parsed?.type==='transfer'&&
   ix.parsed.info?.source===wallet&&
   Number.isSafeInteger(ix.parsed.info?.lamports)&&
   ix.parsed.info.lamports>=100_000);
 // More than one direct transfer is ambiguous: reject without attributing a BUY.
 if(direct.length!==1)return null;
 const transfer=(direct[0] as any).parsed.info;
 const wrapped=(inner.some(ix=>key(ix.programId)===TOKEN_PROGRAM&&
   'parsed' in ix&&ix.parsed?.type==='syncNative'&&
   ix.parsed.info?.account===transfer.destination));
 if(!wrapped)return null;
 // Never confuse a fee/rent-only change with an actual routed SOL spend.
 if(before-after<transfer.lamports||transfer.lamports>1_000_000_000_000)
   return null;
 return transfer.lamports/1e9;
}

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
  if (Buffer.from(data.subarray(0, 8)).toString('hex') !== PUMP_APP_USDC_BUY_TAG) return [];
  const usdcShape=data.length===68;
  const nativeSolShape=data.length===82&&routed[0].accounts.length===83;
  if(!usdcShape&&!nativeSolShape)return [];

  const accounts = tx.transaction.message.accountKeys;
  const results: EchoSignal[] = [];
  for (const [wallet, caller] of Object.entries(ECHO_WALLETS)) {
    if (!accounts.some(account => account.signer === true && key(account.pubkey) === wallet)) continue;
    const deltas = ownerTokenDeltas(tx, wallet);
    if (!deltas) continue;
    const nonzero = [...deltas].filter(([,d]) => d.raw !== 0n);
    const credits=nonzero.filter(([mint,d])=>mint!==USDC&&mint!==SOL&&d.raw>0n);
    if(credits.length!==1)continue;
    const [mint,received]=credits[0];
    let quoteAmount:number,quoteMint:string,quoteSymbol:string;
    let quoteBasis:EchoSignal['quoteBasis'];
    if(usdcShape){
      // Preserve the previously tested Chairman USDC route exactly.
      if(nonzero.length!==2)continue;
      const spent=deltas.get(USDC);
      if(!spent||spent.raw>=0n||!nonzero.every(([m])=>m===USDC||m===mint))continue;
      quoteAmount=Number(-spent.raw)/10**spent.decimals;
      quoteMint=USDC;quoteSymbol='USDC';quoteBasis='token-account net change';
    }else{
      // No token-account debit is allowed for this SOL route form.
      if(nonzero.length!==1||nonzero[0][0]!==mint)continue;
      const verifiedSol=verifiedNativeSolRouteInput(tx,wallet);
      if(verifiedSol===null)continue;
      quoteAmount=verifiedSol;quoteMint=SOL;quoteSymbol='SOL';
      quoteBasis='verified native SOL route transfer';
    }
    const tokenAmount=Number(received.raw)/10**received.decimals;
    if(!Number.isFinite(quoteAmount)||quoteAmount<=0||
       !Number.isFinite(tokenAmount)||tokenAmount<=0)continue;
    results.push({
      id:signature+':'+wallet+':'+mint+':BUY',wallet,caller,signature,
      timestamp:tx.blockTime!,mint,side:'BUY',tokenAmount,
      quoteAmount,quoteMint,quoteSymbol,quoteBasis
    });
  }
  return results;
}
