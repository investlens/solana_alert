import type { ArcWalletRiskEvidence } from './walletRiskShadow.js';
import { buildVerifiedWalletClusters, linksFromCommonFunding, linksFromTokenTransfers } from './walletRelationshipGraph.js';

export type ArcWalletGraphInput = {
  wallets: string[];
  balancesPct?: Record<string, number>;
  funding: Array<{ wallet: string; funder: string; txHash: string }>;
  tokenTransfers: Array<{ from: string; to: string; txHash: string }>;
  excludedFunders?: string[];
};

const normalize = (v: string) => String(v ?? '').toLowerCase();

export function applyVerifiedArcWalletGraph(
  base: ArcWalletRiskEvidence,
  graph: ArcWalletGraphInput,
): ArcWalletRiskEvidence {
  const wallets = new Set(graph.wallets.map(normalize));
  const excluded = new Set((graph.excludedFunders ?? []).map(normalize));
  const links = [
    ...linksFromCommonFunding(graph.funding, excluded),
    ...linksFromTokenTransfers(graph.tokenTransfers, wallets),
  ];
  const clusters = buildVerifiedWalletClusters(wallets, links);

  // A cluster percentage is only publishable when every member has a verified
  // balance percentage. Otherwise leave it null rather than understating risk.
  let largestPct: number | null = null;
  const balances = graph.balancesPct ?? {};
  for (const cluster of clusters) {
    const values = cluster.map(wallet => balances[wallet] ?? balances[normalize(wallet)]);
    if (values.some(value => !Number.isFinite(value))) continue;
    const pct = values.reduce((sum, value) => sum + Number(value), 0);
    largestPct = largestPct == null ? pct : Math.max(largestPct, pct);
  }

  return {
    ...base,
    connectedClusterPct: largestPct,
    evidence: [
      ...(base.evidence ?? []),
      `verified wallet links=${links.length}`,
      `verified connected clusters=${clusters.length}`,
      largestPct == null
        ? 'connected cluster ownership not confirmed'
        : `largest verified connected cluster=${largestPct.toFixed(2)}%`,
    ],
  };
}
