import { PublicKey } from '@solana/web3.js';

// Active monitoring scope: Slingoor only. Historical caller research remains persisted.
export const ECHO_WALLETS: Readonly<Record<string, string>> = Object.freeze({
  '5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij': 'WHALE · slingoor',
});
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
const QUOTES = new Map([[SOL_MINT, 'SOL'], ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USDC']]);
type Leg = { userAccount?: string; mint?: string; amount?: number | string; rawTokenAmount?: { tokenAmount?: string; decimals?: number } };
export type EchoTransaction = {
  type?: string; signature?: string; timestamp?: number; transactionError?: unknown;
  events?: { swap?: { nativeInput?: Leg; nativeOutput?: Leg; tokenInputs?: Leg[]; tokenOutputs?: Leg[] } };
};
export type EchoSignal = {
  id: string; wallet: string; caller: string; signature: string; timestamp: number;
  mint: string; side: 'BUY' | 'SELL'; tokenAmount: number; quoteAmount: number | null; quoteSymbol: string;
  quoteBasis?: 'token-account net change' | 'wallet SOL net change; includes fees/rent' | 'unavailable';
};
function address(value: unknown): value is string {
  try { return typeof value === 'string' && new PublicKey(value).toBase58() === value; } catch { return false; }
}
function quantity(leg: Leg, native = false): number {
  const decimals = native ? 9 : leg.rawTokenAmount?.decimals;
  const raw = native ? leg.amount : leg.rawTokenAmount?.tokenAmount;
  if (!Number.isInteger(decimals) || decimals! < 0 || decimals! > 18 || !/^\d+$/.test(String(raw ?? ''))) return NaN;
  const value = Number(raw) / 10 ** decimals!;
  return Number.isFinite(value) && value > 0 ? value : NaN;
}
// Only explicit aggregate SWAP legs owned by the watched wallet count. Never
// infer buys from token receipts, fee-payer identity, descriptions, or pool hops.
export function extractEchoSignals(tx: EchoTransaction, nowSeconds: number, maxAgeSeconds = 120): EchoSignal[] {
  if (!tx || tx.type !== 'SWAP' || tx.transactionError != null || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(tx.signature ?? '') ||
      !Number.isFinite(tx.timestamp) || tx.timestamp! <= 0 || tx.timestamp! > nowSeconds + 15 || nowSeconds - tx.timestamp! > maxAgeSeconds) return [];
  const swap = tx.events?.swap;
  if (!swap || ![swap.tokenInputs, swap.tokenOutputs].every(x => x == null || Array.isArray(x))) return [];
  const result: EchoSignal[] = [];
  for (const [wallet, caller] of Object.entries(ECHO_WALLETS)) {
    const inputs = (swap.tokenInputs ?? []).filter(x => x?.userAccount === wallet);
    const outputs = (swap.tokenOutputs ?? []).filter(x => x?.userAccount === wallet);
    if (swap.nativeInput?.userAccount === wallet) inputs.push({ ...swap.nativeInput, mint: SOL_MINT, rawTokenAmount: { tokenAmount: String(swap.nativeInput.amount), decimals: 9 } });
    if (swap.nativeOutput?.userAccount === wallet) outputs.push({ ...swap.nativeOutput, mint: SOL_MINT, rawTokenAmount: { tokenAmount: String(swap.nativeOutput.amount), decimals: 9 } });
    // Ambiguous multi-asset and token-to-token transactions are withheld.
    if (inputs.length !== 1 || outputs.length !== 1) continue;
    const input = inputs[0], output = outputs[0];
    if (!address(input.mint) || !address(output.mint) || input.mint === output.mint) continue;
    const buy = QUOTES.has(input.mint) && !QUOTES.has(output.mint);
    const sell = !QUOTES.has(input.mint) && QUOTES.has(output.mint);
    if (!buy && !sell) continue;
    const token = buy ? output : input, quote = buy ? input : output;
    const tokenAmount = quantity(token), quoteAmount = quantity(quote);
    if (!Number.isFinite(tokenAmount) || !Number.isFinite(quoteAmount)) continue;
    const side = buy ? 'BUY' : 'SELL';
    result.push({ id: `${tx.signature}:${wallet}:${token.mint}:${side}`, signature: tx.signature!, wallet, caller,
      timestamp: tx.timestamp!, mint: token.mint!, side, tokenAmount, quoteAmount, quoteSymbol: QUOTES.get(quote.mint!)! });
  }
  return result;
}
// Public X associations are references, not proof that the account controls the trading wallet.
const ECHO_SOCIAL_X: Readonly<Record<string, string>> = Object.freeze({
  Cupsey: 'Cupseyy',
  Croakie: 'croakie_',
  Chairman: 'Chairman_DN',
});
export type EchoCardMarket = { name: string; symbol: string; marketCap: number | null; liquidity: number | null };
function escapeEchoHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
export function echoCard(s: EchoSignal, nowSeconds: number, market?: EchoCardMarket | null): string {
  const age = Math.max(0, Math.round(nowSeconds - s.timestamp));
  const x = ECHO_SOCIAL_X[s.caller];
  const social = x ? ` · <a href="https://x.com/${x}">@${x}</a>` : '';
  const label = market && (market.name || market.symbol)
    ? `<b>${escapeEchoHtml(market.symbol || market.name)}</b>${market.name && market.name !== market.symbol ? ' · ' + escapeEchoHtml(market.name) : ''}`
    : '<b>Name pending</b>';
  const formatUsd = (v: number | null | undefined) => v != null && Number.isFinite(v) && v > 0
    ? '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : 'Unavailable';
  const quote = s.quoteAmount == null ? 'Unavailable' :
    s.quoteBasis === 'wallet SOL net change; includes fees/rent'
      ? `~${s.quoteAmount.toFixed(4)} ${escapeEchoHtml(s.quoteSymbol)} wallet change (not exact trade size)`
      : `${s.quoteAmount.toFixed(4)} ${escapeEchoHtml(s.quoteSymbol)}`;
  return `<b>${s.caller === 'WHALE · slingoor' && s.side === 'BUY' ? '⚡ ALPHAOS ECHO · PREMIUM · SLINGOOR BUY' : '📡 ECHO · ' + (s.side === 'BUY' ? '🟢 BUY' : '🔴 SELL') + ' · ' + escapeEchoHtml(s.caller)}</b>\n` +
    `${label}\n` +
    `💰 <b>MC:</b> ${formatUsd(market?.marketCap)} · <b>LP:</b> ${formatUsd(market?.liquidity)}\n` +
    `💱 <b>Trade:</b> ${quote}\n` +
    `🪙 <b>Tokens:</b> ${s.tokenAmount.toLocaleString('en-US', { maximumFractionDigits: 4 })}\n` +
    `⏱ <b>Age:</b> ${age}s${social}\n` +
    `\n<b>CA:</b> <code>${escapeEchoHtml(s.mint)}</code>\n` +
    `<i>Verified swap · Research only · Auto-buy OFF</i>`;
}

export type PaperStop = { entry: number; peak: number; stop: number; closed: boolean };
export function openPaperStop(entry: number, initialLossPercent = 20): PaperStop {
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(initialLossPercent) || initialLossPercent <= 0 || initialLossPercent >= 100) throw new Error('Invalid paper stop');
  return { entry, peak: entry, stop: entry * (1 - initialLossPercent / 100), closed: false };
}
// Mirrors the existing ROI tiers for offline testing. No execution imports.
export function updatePaperStop(position: PaperStop, executablePrice: number): PaperStop {
  if (!Number.isFinite(executablePrice) || executablePrice <= 0) throw new Error('Invalid executable price');
  if (position.closed) return { ...position };
  if (executablePrice <= position.stop) return { ...position, closed: true };
  const peak = Math.max(position.peak, executablePrice), roi = Math.round((peak / position.entry - 1) * 100 * 1e9) / 1e9;
  const trail = roi >= 100 ? .10 : roi >= 60 ? .12 : roi >= 30 ? .15 : .20;
  const floor = roi >= 100 ? .50 : roi >= 75 ? .35 : roi >= 50 ? .20 : roi >= 30 ? .10 : roi >= 20 ? 0 : null;
  return { ...position, peak, stop: Math.max(position.stop, peak * (1 - trail), floor == null ? 0 : position.entry * (1 + floor)) };
}
