import {
  Connection,
  PublicKey,
  type ParsedAccountData,
  type ParsedInstruction,
  type PartiallyDecodedInstruction,
} from '@solana/web3.js';
import { config } from '../config.js';

export type BundleIntelligenceV2Result = {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  evidenceAvailable: boolean;
  reasons: string[];
  connectedWallets: string[];
  metrics: {
    holdersResolved: number;
    freshWallets: number;
    freshWalletCombinedSharePct: number;
    largestCommonFunderWalletCount: number;
    largestCommonFunderSharePct: number;
    inspectedCombinedSharePct: number;
  };
};

type HolderWallet = { wallet: string; sharePct: number };
type WalletFundingEvidence = { wallet: string; sharePct: number; fresh: boolean; funders: string[] };
const connection = new Connection(config.solanaRpcUrl, 'confirmed');

function emptyMetrics() { return { holdersResolved: 0, freshWallets: 0, freshWalletCombinedSharePct: 0, largestCommonFunderWalletCount: 0, largestCommonFunderSharePct: 0, inspectedCombinedSharePct: 0 }; }
function emptyResult(reason: string): BundleIntelligenceV2Result { return { score: 0, level: 'LOW', evidenceAvailable: false, reasons: [reason], connectedWallets: [], metrics: emptyMetrics() }; }
function round2(value: number) { return Math.round(value * 100) / 100; }

async function resolveLargestHolderWallets(mintAddress: string): Promise<HolderWallet[]> {
  const mint = new PublicKey(mintAddress);
  const [largest, supply] = await Promise.all([connection.getTokenLargestAccounts(mint), connection.getTokenSupply(mint)]);
  const totalSupply = Number(supply.value.uiAmountString ?? supply.value.uiAmount ?? 0);
  if (!Number.isFinite(totalSupply) || totalSupply <= 0) return [];
  const tokenAccounts = largest.value.slice(0, 12);
  if (!tokenAccounts.length) return [];
  const parsed = await Promise.all(tokenAccounts.map((x) => connection.getParsedAccountInfo(x.address, 'confirmed')));
  const walletShares = new Map<string, number>();
  parsed.forEach((account, index) => {
    if (!account.value) return;
    const data = account.value.data as ParsedAccountData;
    const owner = String(data?.parsed?.info?.owner ?? '').trim();
    if (!owner) return;
    const amount = Number(tokenAccounts[index]?.uiAmountString ?? tokenAccounts[index]?.uiAmount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const sharePct = (amount / totalSupply) * 100;
    walletShares.set(owner, (walletShares.get(owner) ?? 0) + sharePct);
  });
  return [...walletShares.entries()].map(([wallet, sharePct]) => ({ wallet, sharePct })).sort((a, b) => b.sharePct - a.sharePct);
}

function extractNativeFunder(wallet: string, instructions: Array<ParsedInstruction | PartiallyDecodedInstruction>): string[] {
  const funders = new Set<string>();
  for (const ix of instructions) {
    if (!('parsed' in ix)) continue;
    const parsed = ix.parsed as any;
    if (!parsed || parsed.type !== 'transfer') continue;
    const info = parsed.info ?? {};
    const destination = String(info.destination ?? '').trim();
    const source = String(info.source ?? '').trim();
    const lamports = Number(info.lamports ?? 0);
    if (destination === wallet && source && source !== wallet && Number.isFinite(lamports) && lamports > 0) funders.add(source);
  }
  return [...funders];
}

async function inspectWallet(holder: HolderWallet): Promise<WalletFundingEvidence> {
  const key = new PublicKey(holder.wallet);
  const signatures = await connection.getSignaturesForAddress(key, { limit: 21 }, 'confirmed');
  const fresh = signatures.length < 21;
  const funders = new Set<string>();

  if (fresh && signatures.length) {
    // RPC returns newest -> oldest. For a low-history wallet, the tail is closest
    // to wallet creation/funding; inspect several in case ATA creation precedes SOL.
    const likelyFunding = signatures.slice(-5);
    for (const sig of likelyFunding) {
      try {
        const tx = await connection.getParsedTransaction(sig.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        if (!tx) continue;
        for (const funder of extractNativeFunder(holder.wallet, tx.transaction.message.instructions)) funders.add(funder);
      } catch (error) {
        console.log('[BundleIntelligenceV2] funding tx inspect failed', { wallet: holder.wallet, signature: sig.signature, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { wallet: holder.wallet, sharePct: holder.sharePct, fresh, funders: [...funders] };
}

export async function getBundleIntelligenceV2(mintAddress: string): Promise<BundleIntelligenceV2Result> {
  try {
    const resolved = await resolveLargestHolderWallets(mintAddress);
    if (resolved.length < 3) return emptyResult('Bundle V2 could not resolve enough holder wallets');
    const clusterCandidates = resolved.filter((x) => x.sharePct >= 0.1 && x.sharePct <= 20).slice(0, 8);
    if (clusterCandidates.length < 3) return { ...emptyResult('Not enough distributed holder wallets for bundle analysis'), evidenceAvailable: true, metrics: { ...emptyMetrics(), holdersResolved: resolved.length } };

    const inspected = await Promise.all(clusterCandidates.map(inspectWallet));
    const freshWallets = inspected.filter((x) => x.fresh);
    const freshWalletCombinedSharePct = freshWallets.reduce((sum, x) => sum + x.sharePct, 0);
    const inspectedCombinedSharePct = inspected.reduce((sum, x) => sum + x.sharePct, 0);
    const funderGroups = new Map<string, WalletFundingEvidence[]>();
    for (const wallet of inspected) for (const funder of wallet.funders) { const group = funderGroups.get(funder) ?? []; group.push(wallet); funderGroups.set(funder, group); }

    let largestCommonFunderWalletCount = 0;
    let largestCommonFunderSharePct = 0;
    let strongestConnectedWallets: string[] = [];
    for (const group of funderGroups.values()) {
      const unique = [...new Map(group.map((x) => [x.wallet, x])).values()];
      const share = unique.reduce((sum, x) => sum + x.sharePct, 0);
      if (unique.length > largestCommonFunderWalletCount || (unique.length === largestCommonFunderWalletCount && share > largestCommonFunderSharePct)) {
        largestCommonFunderWalletCount = unique.length;
        largestCommonFunderSharePct = share;
        strongestConnectedWallets = unique.map((x) => x.wallet);
      }
    }

    let score = 0;
    const reasons: string[] = [];
    if (largestCommonFunderWalletCount >= 4 && largestCommonFunderSharePct >= 12) { score += 90; reasons.push(`${largestCommonFunderWalletCount} large holders share a funding source and control ${round2(largestCommonFunderSharePct)}%`); }
    else if (largestCommonFunderWalletCount >= 3 && largestCommonFunderSharePct >= 8) { score += 75; reasons.push(`${largestCommonFunderWalletCount} large holders share a funding source and control ${round2(largestCommonFunderSharePct)}%`); }
    else if (largestCommonFunderWalletCount >= 2 && largestCommonFunderSharePct >= 10) { score += 40; reasons.push(`Two large holders share a funding source and control ${round2(largestCommonFunderSharePct)}%`); }

    if (freshWallets.length >= 8 && freshWalletCombinedSharePct >= 25) { score += 75; reasons.push(`${freshWallets.length} low-history wallets collectively control ${round2(freshWalletCombinedSharePct)}%`); }
    else if (freshWallets.length >= 5 && freshWalletCombinedSharePct >= 15) { score += 35; reasons.push(`${freshWallets.length} low-history wallets collectively control ${round2(freshWalletCombinedSharePct)}%`); }

    score = Math.max(0, Math.min(100, score));
    const level = score >= 75 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
    if (!reasons.length) reasons.push('No connected high-supply wallet cluster detected');
    const result: BundleIntelligenceV2Result = { score, level, evidenceAvailable: true, reasons, connectedWallets: strongestConnectedWallets, metrics: { holdersResolved: resolved.length, freshWallets: freshWallets.length, freshWalletCombinedSharePct: round2(freshWalletCombinedSharePct), largestCommonFunderWalletCount, largestCommonFunderSharePct: round2(largestCommonFunderSharePct), inspectedCombinedSharePct: round2(inspectedCombinedSharePct) } };
    console.log('[BundleIntelligenceV2] result', { mintAddress, ...result });
    return result;
  } catch (error) {
    console.log('[BundleIntelligenceV2] unavailable', { mintAddress, error: error instanceof Error ? error.message : String(error) });
    return emptyResult('Bundle V2 evidence unavailable');
  }
}
