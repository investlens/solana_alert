import { formatEther, formatUnits, parseEther } from 'viem';
import { getPonsFactoryDeployments } from '../chains/robinhood/ponsContracts.js';
import { getPonsV2CurveState, quotePonsV2Buy, quotePonsV2Sell, type PonsV2CurveState } from '../chains/robinhood/ponsV2CurveQuote.js';
import { requestRobinhoodRpcResilient } from '../chains/robinhood/rpc.js';
import { getVerifiedPonsPublicContext, getCreatorHoldingPercent } from '../chains/robinhood/ponsPublicContext.js';
import { scanRobinhoodHolderRisk } from '../chains/robinhood/security/holderRiskScanner.js';
import { getRobinhoodTokenMetadata } from '../chains/robinhood/tokenMetadata.js';
import { getSharedJson } from './sharedJsonCache.js';

export const POSITION_SIZES = ['0.001', '0.01', '0.05'] as const;
export type PositionSize = typeof POSITION_SIZES[number];
export type PositionCheck = {
  token: string; size: PositionSize; checkedAt: number; block: string | null; reason: string | null;
  quote: null | { tokens: string; spentEth: string; recoveredEth: string; buyFeeEth: string; sellFeeEth: string;
    priceImpactPct: number; roundTripLossPct: number; partialFill: boolean };
  holders: null | { top10: number; largest: number; sampled: number; excluded: number; at: number };
  setup: null | { belowLow: boolean; at: number };
  creator: null | { wallet: string; holding: number; change: number | null; baselineAt: number | null; baselineKind: 'ALERT' | 'FIRST_CHECK'; at: number };
};
export function modelPosition(state: PonsV2CurveState, size: PositionSize, decimals: number): NonNullable<PositionCheck['quote']> {
  if (state.feeBps < 0n || state.creatorTaxBps < 0n || state.feeBps + state.creatorTaxBps >= 10_000n
    || state.quoteReserve <= 0n || state.tokenReserve <= 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw Error('Invalid curve evidence');
  const buy = quotePonsV2Buy({ state, quoteInRaw: parseEther(size) });
  if (buy.tokensOutRaw <= 0n || buy.netQuoteInRaw <= 0n) throw Error('No meaningful model output');
  if (buy.partialFill || buy.tokensOutRaw >= state.sellableTokens) throw Error('Allocation boundary: graduation can change the sell venue; select a smaller size');
  const postBuy = { ...state, quoteReserve: state.quoteReserve + buy.netQuoteInRaw,
    tokenReserve: state.tokenReserve - buy.tokensOutRaw, sellableTokens: state.sellableTokens - buy.tokensOutRaw };
  const sell = quotePonsV2Sell({ state: postBuy, tokensInRaw: buy.tokensOutRaw });
  const marginal = Number(state.quoteReserve) / Number(state.tokenReserve);
  const average = Number(buy.netQuoteInRaw) / Number(buy.tokensOutRaw);
  if (![marginal, average].every(value => Number.isFinite(value) && value > 0)) throw Error('Invalid model precision');
  return { tokens: formatUnits(buy.tokensOutRaw, decimals), spentEth: formatEther(buy.actuallySpentRaw),
    recoveredEth: formatEther(sell.quoteOutRaw), buyFeeEth: formatEther(buy.feeRaw + buy.creatorTaxRaw),
    sellFeeEth: formatEther(sell.feeRaw + sell.creatorTaxRaw), priceImpactPct: (average / marginal - 1) * 100,
    roundTripLossPct: (1 - Number(sell.quoteOutRaw) / Number(buy.actuallySpentRaw)) * 100, partialFill: buy.partialFill };
}

type Baseline = { creator: string; holding: number; at: number };
const baselines = new Map<string, Baseline>();
const cache = new Map<string, PositionCheck>();
const pending = new Map<string, Promise<PositionCheck>>();
export async function getPositionCheck(token: string, size: PositionSize): Promise<PositionCheck> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(token) || !POSITION_SIZES.includes(size)) throw Error('Invalid position check');
  token = token.toLowerCase(); const key = `${token}:${size}`;
  const cached = cache.get(key); if (cached && Date.now() - cached.checkedAt < 15_000) return cached;
  const inFlight = pending.get(key); if (inFlight) return inFlight;
  if (pending.size >= 3) throw Error('Position checks are busy; try again shortly');
  const run = analyze(token, size); pending.set(key, run);
  try { const result = await run; if (cache.size >= 50) cache.delete(cache.keys().next().value!); cache.set(key, result); return result; }
  finally { pending.delete(key); }
}

async function analyze(token: string, size: PositionSize): Promise<PositionCheck> {
  const result: PositionCheck = { token, size, checkedAt: Date.now(), block: null, reason: null, quote: null, holders: null, creator: null, setup: null };
  const signal = AbortSignal.timeout(8_000);
  const work = async () => {
    const marker = (await getSharedJson<{ factory: string; token?: string; curveAddress?: string; creator?: string }>(`alphaos:pons:verified:${token}`))?.value;
    const trustedMarker = marker && getPonsFactoryDeployments().some(f => f.enabled && f.generation === 'v2' && f.address.toLowerCase() === marker.factory?.toLowerCase())
      && marker.token?.toLowerCase() === token ? marker : null;
    const context = trustedMarker?.curveAddress && trustedMarker?.creator ? null : await getVerifiedPonsPublicContext(token);
    if (signal.aborted) return;
    const curve = trustedMarker?.curveAddress ?? context?.curveAddress;
    const creator = trustedMarker?.creator ?? context?.creator;
    if (!curve || !/^0x[a-fA-F0-9]{40}$/.test(curve) || !creator || !/^0x[a-fA-F0-9]{40}$/.test(creator)) {
      result.reason = 'Verified PONS curve provenance unavailable. Indexed/ARC execution is not supported yet.'; return;
    }
    const block = await requestRobinhoodRpcResilient<`0x${string}`>({ method: 'eth_blockNumber', params: [] });
    if (signal.aborted) return;
    const metadataPromise = getRobinhoodTokenMetadata(token, { signal });
    const [state, holders, holding, curveBalance] = await Promise.allSettled([
      getPonsV2CurveState(curve, block),
      metadataPromise.then(metadata => scanRobinhoodHolderRisk(token, { poolAddress: curve, metadata, signal, timeoutMs: 3_000 })),
      getCreatorHoldingPercent(token, creator),
      requestRobinhoodRpcResilient<`0x${string}`>({ method: 'eth_getBalance', params: [curve, block] }),
    ]);
    if (signal.aborted) return;
    const metadata = await metadataPromise;
    if (signal.aborted) return;
    const setup = (await getSharedJson<{ creator: string; holding: number | null; rawLow: number; curve: string; at: number }>(`alphaos:setup:evidence:${token}`))?.value;
    if (signal.aborted) return;
    const validSetup = setup && setup.creator?.toLowerCase() === creator.toLowerCase() && setup.curve?.toLowerCase() === curve.toLowerCase()
      && Number.isFinite(setup.at) && Date.now() >= setup.at && Date.now() - setup.at <= 2 * 60 * 60_000 ? setup : null;
    result.block = BigInt(block).toString(); result.checkedAt = Date.now();
    if (state.status === 'fulfilled' && state.value.tokenAddress.toLowerCase() === token && state.value.nativeQuote && !state.value.graduated && metadata.decimals != null) {
      try {
        const quote = modelPosition(state.value, size, metadata.decimals);
        // The hypothetical buy adds net funds; quote reserve can contain virtual
        // amounts, so check actual native balance before presenting resale proceeds.
        if (curveBalance.status !== 'fulfilled') throw Error('Actual curve funds unavailable');
        const buy = quotePonsV2Buy({ state: state.value, quoteInRaw: parseEther(size) });
        if (BigInt(curveBalance.value) + buy.netQuoteInRaw < parseEther(quote.recoveredEth) + parseEther(quote.sellFeeEth)) throw Error('Curve funds do not cover modeled gross resale');
        result.quote = quote;
        if (validSetup && Number.isFinite(validSetup.rawLow) && validSetup.rawLow > 0) result.setup = { belowLow: Number(state.value.quoteReserve) / Number(state.value.tokenReserve) < validSetup.rawLow, at: validSetup.at };
      } catch (error) { result.reason = error instanceof Error ? error.message : 'Curve model could not produce a valid estimate.'; }
    } else result.reason = 'Native-ETH pre-bond curve evidence unavailable or curve graduated.';
    if (holders.status === 'fulfilled' && holders.value.top10Pct != null && holders.value.top1Pct != null && holders.value.sampledWallets.length
      && [holders.value.top10Pct, holders.value.top1Pct].every(value => Number.isFinite(value) && value >= 0 && value <= 100)) {
      result.holders = { top10: holders.value.top10Pct, largest: holders.value.top1Pct, sampled: holders.value.circulatingHolderCountObserved,
        excluded: holders.value.excludedHolderCount, at: holders.value.scannedAt };
    }
    if (holding.status === 'fulfilled' && holding.value != null && Number.isFinite(holding.value) && holding.value >= 0 && holding.value <= 100) {
      const firstCheck = baselines.get(token);
      const previous = validSetup && validSetup.holding != null && Number.isFinite(validSetup.holding)
        ? { creator: validSetup.creator, holding: validSetup.holding, at: validSetup.at } : firstCheck;
      result.creator = { wallet: creator, holding: holding.value, change: previous?.creator.toLowerCase() === creator.toLowerCase() ? holding.value - previous.holding : null,
        baselineKind: validSetup && validSetup.holding != null ? 'ALERT' : 'FIRST_CHECK',
        baselineAt: previous?.creator.toLowerCase() === creator.toLowerCase() ? previous.at : null, at: Date.now() };
      if (!previous || previous.creator.toLowerCase() !== creator.toLowerCase()) {
        if (baselines.size >= 100) baselines.delete(baselines.keys().next().value!);
        baselines.set(token, { creator, holding: holding.value, at: Date.now() });
      }
    }
  };
  await Promise.race([work().catch(() => { if (!signal.aborted) result.reason = 'Position evidence unavailable.'; }),
    new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))]);
  if (signal.aborted) result.reason = 'Evidence deadline reached; unable to complete this check.';
  return result;
}
