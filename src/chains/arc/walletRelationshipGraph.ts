export type ArcWalletLinkReason = 'COMMON_FUNDER' | 'TOKEN_TRANSFER';

export type ArcWalletLink = {
  a: string;
  b: string;
  reason: ArcWalletLinkReason;
  evidenceId: string;
};

const addr = (value: unknown) => String(value ?? '').trim().toLowerCase();
const isAddress = (value: string) => /^0x[0-9a-f]{40}$/.test(value);

/**
 * Builds connected components only from direct on-chain evidence.
 * Timing similarity, same-block buys and similar trade sizes are intentionally
 * excluded: they are useful signals but do not prove common control.
 */
export function buildVerifiedWalletClusters(
  wallets: Iterable<string>,
  links: ArcWalletLink[],
): string[][] {
  const nodes = new Set([...wallets].map(addr).filter(isAddress));
  const parent = new Map<string, string>();
  for (const node of nodes) parent.set(node, node);

  const find = (x: string): string => {
    const p = parent.get(x);
    if (!p || p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  for (const link of links) {
    const a = addr(link.a);
    const b = addr(link.b);
    if (!nodes.has(a) || !nodes.has(b) || a === b) continue;
    if (!link.evidenceId) continue;
    union(a, b);
  }

  const groups = new Map<string, string[]>();
  for (const node of nodes) {
    const root = find(node);
    const group = groups.get(root) ?? [];
    group.push(node);
    groups.set(root, group);
  }

  return [...groups.values()]
    .filter(group => group.length > 1)
    .sort((a, b) => b.length - a.length);
}

/**
 * A common funding wallet is strong relationship evidence only when there is an
 * actual funding transaction id for each recipient. Merely sharing a service,
 * router or exchange address must be excluded by the caller.
 */
export function linksFromCommonFunding(
  funding: Array<{ wallet: string; funder: string; txHash: string }>,
  excludedFunders: Set<string> = new Set(),
): ArcWalletLink[] {
  const byFunder = new Map<string, Array<{ wallet: string; txHash: string }>>();
  for (const row of funding) {
    const wallet = addr(row.wallet);
    const funder = addr(row.funder);
    const txHash = String(row.txHash ?? '').toLowerCase();
    if (!isAddress(wallet) || !isAddress(funder) || !/^0x[0-9a-f]{64}$/.test(txHash)) continue;
    if (excludedFunders.has(funder)) continue;
    const rows = byFunder.get(funder) ?? [];
    rows.push({ wallet, txHash });
    byFunder.set(funder, rows);
  }

  const links: ArcWalletLink[] = [];
  for (const [funder, rows] of byFunder) {
    const unique = [...new Map(rows.map(row => [row.wallet, row])).values()];
    for (let i = 1; i < unique.length; i += 1) {
      links.push({
        a: unique[0].wallet,
        b: unique[i].wallet,
        reason: 'COMMON_FUNDER',
        evidenceId: `${funder}:${unique[0].txHash}:${unique[i].txHash}`,
      });
    }
  }
  return links;
}

export function linksFromTokenTransfers(
  transfers: Array<{ from: string; to: string; txHash: string }>,
  candidateWallets: Set<string>,
): ArcWalletLink[] {
  const wanted = new Set([...candidateWallets].map(addr));
  return transfers.flatMap(row => {
    const from = addr(row.from);
    const to = addr(row.to);
    const txHash = String(row.txHash ?? '').toLowerCase();
    if (!wanted.has(from) || !wanted.has(to) || from === to || !/^0x[0-9a-f]{64}$/.test(txHash)) return [];
    return [{ a: from, b: to, reason: 'TOKEN_TRANSFER' as const, evidenceId: txHash }];
  });
}
