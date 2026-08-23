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
