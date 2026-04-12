export type DexProfile = {
  chainId?: string;
  tokenAddress?: string;
  url?: string;
  description?: string | null;
  links?: Array<{ type?: string; label?: string; url?: string }> | null;
};

export type DexOrder = {
  type?: string;
  status?: string;
  paymentTimestamp?: number;
};

export type DexPair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  priceUsd?: string | null;
  fdv?: number | null;
  marketCap?: number | null;
  pairCreatedAt?: number | null;
  liquidity?: { usd?: number | null; base?: number | null; quote?: number | null } | null;
  txns?: {
    m5?: { buys?: number; sells?: number };
    h1?: { buys?: number; sells?: number };
    h24?: { buys?: number; sells?: number };
  } | null;
  volume?: { m5?: number; h1?: number; h24?: number } | null;
  baseToken?: { address?: string; name?: string; symbol?: string } | null;
  quoteToken?: { address?: string; name?: string; symbol?: string } | null;
  boosts?: { active?: number } | null;
  labels?: string[] | null;
};

export type BoostToken = {
  chainId?: string;
  tokenAddress?: string;
  amount?: number;
  totalAmount?: number;
};

export type TakeoverToken = {
  chainId?: string;
  tokenAddress?: string;
};

export type RiskResult = {
  score: number;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  action: 'WATCH' | 'MANUAL BUY ONLY' | 'SKIP';
  checksGood: string[];
  checksWarn: string[];
  checksBad: string[];
  liquidityUsd: number;
  ageMin: number;
  buys5m: number;
  sells5m: number;
  volume5m: number;
  boosts: number;
  paidApproved: boolean;
  hasProfileLinks: boolean;
  marketSafetyScore: number;
  marketSafetyLabel: 'GOOD' | 'WATCH' | 'RISKY';
  fdv: number;
  marketCap: number;
  currentPrice: number | null;
};

export type TokenState = {
  tokenAddress: string;
  firstSeenAt: number;
  ownerSent: boolean;
  paidSent: boolean;
  freeSent: boolean;
  paidDueAt: number;
  freeDueAt: number;
  lastScore: number;
  lastPairAddress?: string;

  alertId?: string;
  adminDelivered?: boolean;

  alertPrice?: number | null;
  alertLiquidity?: number;
  alertScore?: number;
  alertBuys5m?: number;
  alertSells5m?: number;
};

export type EnrichedToken = {
  pair: DexPair;
  result: RiskResult;
};

export type MarketSafetyResult = {
  marketSafetyScore: number;
  marketSafetyLabel: 'GOOD' | 'WATCH' | 'RISKY';
  reasonsGood: string[];
  reasonsWarn: string[];
  reasonsBad: string[];
};

export type FreeTrialInfo = {
  used: number;
  limit: number;
  fastDelayActive: boolean;
  freeDelaySec: number;
};