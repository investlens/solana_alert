import { getAddress } from 'viem';

import {
  getVerifiedRobinhoodQuoteUsd,
  isFreshQuoteUsdObservation,
  type QuoteUsdObservation,
} from './market.js';
import { PONS_CONTRACTS } from './ponsContracts.js';
import type { PonsV2CurveState } from './ponsV2CurveQuote.js';
import {
  getRobinhoodTokenMetadata,
  type RobinhoodTokenMetadata,
} from './tokenMetadata.js';

export type PonsPreIndexValuationInput = {
  version: 'V1' | 'V2';
  quotePriceRaw: bigint | null;
  quoteDecimals: number | null;
  quoteUsd: number | null;
  totalSupplyRaw: bigint | null;
  tokenDecimals: number | null;
  circulatingSupplyRaw: bigint | null;
};

export type PonsPreIndexValuation = {
  state: 'UNAVAILABLE' | 'VERIFIED_FDV' | 'VERIFIED_MARKET_CAP';
  usdValue: number | null;
  missing: string[];
};

export type VerifiedPonsPreIndexValuation = {
  tokenAddress: string;
  valueUsd: number;
  valuationType: 'MARKET_CAP' | 'FDV';
  source: 'PONS_V2_CURVE_RESERVE_SPOT';
  tokenPriceUsd: number;
  tokenPriceSource: 'PONS_V2_CURVE_RESERVE_RATIO';
  quoteAsset: string;
  quoteUsd: number;
  quoteUsdSource: string;
  observedAt: string;
  indexed: false;
  feeBps: number;
  creatorTaxBps: number;
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const METADATA_CACHE_MS = 5 * 60 * 1000;
const metadataCache = new Map<string, { expiresAt: number; value: RobinhoodTokenMetadata }>();
const metadataInFlight = new Map<string, Promise<RobinhoodTokenMetadata>>();

function normalizedAmount(raw: bigint, decimals: number): number {
  if (raw <= 0n || decimals < 0 || decimals > 30) return 0;
  const value = Number(raw) / (10 ** decimals);
  return Number.isFinite(value) ? value : 0;
}

async function cachedMetadata(address: string): Promise<RobinhoodTokenMetadata> {
  const key = address.toLowerCase();
  const cached = metadataCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = metadataInFlight.get(key);
  if (pending) return pending;
  const request = getRobinhoodTokenMetadata(address)
    .then((value) => {
      metadataCache.set(key, { expiresAt: Date.now() + METADATA_CACHE_MS, value });
      return value;
    })
    .finally(() => metadataInFlight.delete(key));
  metadataInFlight.set(key, request);
  return request;
}

export function derivePonsV2PreIndexValuation(args: {
  curveState: PonsV2CurveState;
  tokenMetadata: RobinhoodTokenMetadata;
  quoteMetadata?: RobinhoodTokenMetadata | null;
  quoteUsd: QuoteUsdObservation;
  circulatingSupplyRaw?: bigint | null;
  now?: number;
}): VerifiedPonsPreIndexValuation | null {
  const { curveState, tokenMetadata } = args;
  if (curveState.graduated || curveState.quoteReserve <= 0n || curveState.tokenReserve <= 0n) return null;
  if (curveState.tokenAddress.toLowerCase() !== tokenMetadata.address.toLowerCase()) return null;
  if (tokenMetadata.decimals == null || tokenMetadata.totalSupplyRaw == null || tokenMetadata.totalSupplyRaw <= 0n) return null;

  const nativeQuote = curveState.nativeQuote && curveState.pairToken.toLowerCase() === ZERO_ADDRESS;
  const pricedQuoteAddress = nativeQuote ? getAddress(PONS_CONTRACTS.weth) : curveState.pairToken;
  const quoteDecimals = nativeQuote ? 18 : args.quoteMetadata?.decimals;
  if (quoteDecimals == null) return null;
  if (!nativeQuote && args.quoteMetadata?.address.toLowerCase() !== curveState.pairToken.toLowerCase()) return null;
  if (args.quoteUsd.quoteAddress.toLowerCase() !== pricedQuoteAddress.toLowerCase()) return null;
  if (!isFreshQuoteUsdObservation(args.quoteUsd, args.now)) return null;

  const quoteReserve = normalizedAmount(curveState.quoteReserve, quoteDecimals);
  const tokenReserve = normalizedAmount(curveState.tokenReserve, tokenMetadata.decimals);
  if (quoteReserve <= 0 || tokenReserve <= 0) return null;
  const tokenPriceInQuote = quoteReserve / tokenReserve;
  const tokenPriceUsd = tokenPriceInQuote * args.quoteUsd.usdPrice!;
  const supplyRaw = args.circulatingSupplyRaw ?? tokenMetadata.totalSupplyRaw;
  const supply = normalizedAmount(supplyRaw, tokenMetadata.decimals);
  const valueUsd = tokenPriceUsd * supply;
  if (![tokenPriceUsd, supply, valueUsd].every(value => Number.isFinite(value) && value > 0)) return null;

  return {
    tokenAddress: curveState.tokenAddress,
    valueUsd,
    valuationType: args.circulatingSupplyRaw == null ? 'FDV' : 'MARKET_CAP',
    source: 'PONS_V2_CURVE_RESERVE_SPOT',
    tokenPriceUsd,
    tokenPriceSource: 'PONS_V2_CURVE_RESERVE_RATIO',
    quoteAsset: pricedQuoteAddress,
    quoteUsd: args.quoteUsd.usdPrice!,
    quoteUsdSource: args.quoteUsd.source!,
    observedAt: args.quoteUsd.observedAt,
    indexed: false,
    feeBps: Number(curveState.feeBps),
    creatorTaxBps: Number(curveState.creatorTaxBps),
  };
}

export async function resolvePonsV2PreIndexValuation(
  curveState: PonsV2CurveState,
): Promise<VerifiedPonsPreIndexValuation | null> {
  const pricedQuoteAddress = curveState.nativeQuote
    ? getAddress(PONS_CONTRACTS.weth)
    : curveState.pairToken;
  const work = Promise.all([
    cachedMetadata(curveState.tokenAddress),
    curveState.nativeQuote ? Promise.resolve(null) : cachedMetadata(curveState.pairToken),
    getVerifiedRobinhoodQuoteUsd(pricedQuoteAddress),
  ]).then(([tokenMetadata, quoteMetadata, quoteUsd]) =>
    derivePonsV2PreIndexValuation({ curveState, tokenMetadata, quoteMetadata, quoteUsd }));
  return new Promise(resolve => {
    const timeout = setTimeout(() => resolve(null), 2_500);
    work.then(
      value => { clearTimeout(timeout); resolve(value); },
      () => { clearTimeout(timeout); resolve(null); },
    );
  });
}

export function analyzePonsPreIndexValuation(
  input: PonsPreIndexValuationInput,
): PonsPreIndexValuation {
  const missing: string[] = [];
  if (input.quotePriceRaw == null || input.quotePriceRaw <= 0n) missing.push('quote price');
  if (input.quoteDecimals == null || input.quoteDecimals < 0) missing.push('quote decimals');
  if (input.quoteUsd == null || !Number.isFinite(input.quoteUsd) || input.quoteUsd <= 0) missing.push('verified quote USD price');
  if (input.tokenDecimals == null || input.tokenDecimals < 0) missing.push('token decimals');
  const supply = input.circulatingSupplyRaw ?? input.totalSupplyRaw;
  if (supply == null || supply <= 0n) missing.push('valuation supply');
  if (missing.length > 0) return { state: 'UNAVAILABLE', usdValue: null, missing };

  const tokenPriceInQuote = Number(input.quotePriceRaw!) / (10 ** input.quoteDecimals!);
  const tokenSupply = Number(supply!) / (10 ** input.tokenDecimals!);
  const usdValue = tokenPriceInQuote * input.quoteUsd! * tokenSupply;
  if (!Number.isFinite(usdValue) || usdValue <= 0) {
    return { state: 'UNAVAILABLE', usdValue: null, missing: ['finite USD valuation'] };
  }
  return {
    state: input.circulatingSupplyRaw == null ? 'VERIFIED_FDV' : 'VERIFIED_MARKET_CAP',
    usdValue,
    missing: [],
  };
}
