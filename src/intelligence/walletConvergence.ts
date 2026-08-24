export type WalletBuyEvidence = { walletAddress: string; tokenAddress: string; detectedAt: string };
export function detectTrackedWalletCluster(rows: WalletBuyEvidence[], windowSeconds = 120, minimumWallets = 3) {
  const sorted = [...rows].sort((a, b) => Date.parse(a.detectedAt) - Date.parse(b.detectedAt));
  for (let right = 0; right < sorted.length; right += 1) {
    const token = sorted[right].tokenAddress.toLowerCase();
    const start = Date.parse(sorted[right].detectedAt) - windowSeconds * 1000;
    const candidates = sorted.filter(row => row.tokenAddress.toLowerCase() === token && Date.parse(row.detectedAt) >= start && Date.parse(row.detectedAt) <= Date.parse(sorted[right].detectedAt));
    const wallets = [...new Set(candidates.map(row => row.walletAddress.toLowerCase()))];
    if (wallets.length >= minimumWallets) return { tokenAddress: sorted[right].tokenAddress, walletCount: wallets.length, windowSeconds, wording: `${wallets.length} tracked wallets bought within ${Math.round(windowSeconds / 60)}m` };
  }
  return null;
}
