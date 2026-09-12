export type IntelligenceChain = "solana" | "robinhood" | "unknown";
export type EvidenceState = "VERIFIED" | "VERIFYING" | "STALE" | "UNAVAILABLE";

export type LiveIntelligenceStatus = {
  highConviction: number;
  watching: number;
  riskBlocked: number;
  totalEvents: number;
  marketEvidenceEvents: number;
};

export type TopOpportunity = {
  id: number | string;
  token: string;
  chain: IntelligenceChain;
  symbol: string | null;
  state: string | null;
  type: string | null;
  confidence: number | null;
  risk: string | null;
  reason: string | null;
  price: number | null;
  marketCap: number | null;
  liquidity: number | null;
  volume5m: number | null;
  devHolding: number | null;
  devHoldingEvidence: string | null;
  priceProvenance: string | null;
  valuationProvenance: string | null;
  createdAt: string | null;
};

export type LifecycleEvent = {
  id: number | string;
  token: string;
  chain: IntelligenceChain;
  symbol: string | null;
  state: string | null;
  type: string | null;
  confidence: number | null;
  risk: string | null;
  reason: string | null;
  currentRoi: number | null;
  marketCap: number | null;
  liquidity: number | null;
  observedAt: string | null;
};

export type TokenLifecycle = {
  token: string;
  chain: IntelligenceChain;
  symbol: string | null;
  currentState: string | null;
  currentRisk: string | null;
  latestObservedAt: string | null;
  events: LifecycleEvent[];
};

export type ShadowOutcome = {
  shadow_decision_id: number;
  checkpoint_seconds: number;
  roi: number | null;
  peak_roi: number | null;
  max_drawdown: number | null;
  outcome_status: string | null;
  measured_at: string | null;
};

export type ShadowDecision = {
  id: number;
  createdAt: string;
  chain: string;
  symbol: string | null;
  currentAction: string | null;
  shadowAction: string | null;
  currentScore: number | null;
  shadowScore: number | null;
  confidence: number | null;
  scoreDelta: number | null;
  promotionEligible: boolean;
  topPositiveReasons: unknown[];
  topNegativeReasons: unknown[];
  outcomes: unknown[];
};

export type LiveIntelligenceProof = {
  generatedAt: string;
  status: LiveIntelligenceStatus;
  topOpportunity: TopOpportunity | null;
  lifecycles: TokenLifecycle[];
  health: Array<Record<string, unknown>>;
  decisions: ShadowDecision[];
};

export function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function normalizeChain(value: unknown): IntelligenceChain {
  const chain = String(value ?? "").toLowerCase();
  if (chain === "solana" || chain === "robinhood") return chain;
  return "unknown";
}
