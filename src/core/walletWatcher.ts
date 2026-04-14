import { config } from '../config.js';

type EnhancedTx = {
  description?: string;
  type?: string;
  signature?: string;
  timestamp?: number;
  source?: string;
  nativeTransfers?: Array<{
    fromUserAccount?: string;
    toUserAccount?: string;
    amount?: number;
  }>;
  tokenTransfers?: Array<{
    fromUserAccount?: string;
    toUserAccount?: string;
    mint?: string;
    tokenAmount?: number;
  }>;
};

type WalletWatchEvent =
  | {
      kind: 'buy';
      wallet: string;
      signature: string;
      timestamp?: number;
      tokenMint: string | null;
      amountSol: number | null;
      type: string;
    }
  | {
      kind: 'launch';
      wallet: string;
      signature: string;
      timestamp?: number;
      tokenMint: string | null;
      type: string;
    };

const seenSignatures = new Set<string>();

async function fetchEnhancedTransactionsForWallet(wallet: string): Promise<EnhancedTx[]> {
  if (!config.heliusApiKey) return [];

  const url = `https://api-mainnet.helius-rpc.com/v0/addresses/${wallet}/transactions?api-key=${config.heliusApiKey}&limit=20`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Helius wallet tx fetch failed ${res.status}: ${text}`);
  }

  return (await res.json()) as EnhancedTx[];
}

function lamportsToSol(lamports?: number) {
  if (lamports == null || !Number.isFinite(lamports)) return null;
  return lamports / 1_000_000_000;
}

function extractBuyEvent(wallet: string, tx: EnhancedTx): WalletWatchEvent | null {
  const type = tx.type ?? 'UNKNOWN';

  if (!['SWAP', 'BUY'].includes(type)) return null;

  const tokenMint =
    tx.tokenTransfers?.find(
      (t) =>
        t.toUserAccount === wallet &&
        t.mint &&
        !String(t.mint).toUpperCase().includes('SO11111111111111111111111111111111111111112')
    )?.mint ?? tx.tokenTransfers?.[0]?.mint ?? null;

  const amountLamports =
    tx.nativeTransfers?.find((n) => n.fromUserAccount === wallet)?.amount ?? null;

  return {
    kind: 'buy',
    wallet,
    signature: tx.signature ?? '',
    timestamp: tx.timestamp,
    tokenMint,
    amountSol: lamportsToSol(amountLamports ?? undefined),
    type,
  };
}

function extractLaunchEvent(wallet: string, tx: EnhancedTx): WalletWatchEvent | null {
  const type = tx.type ?? 'UNKNOWN';

  if (!['TOKEN_MINT'].includes(type)) return null;

  const tokenMint =
    tx.tokenTransfers?.find((t) => t.mint)?.mint ?? null;

  return {
    kind: 'launch',
    wallet,
    signature: tx.signature ?? '',
    timestamp: tx.timestamp,
    tokenMint,
    type,
  };
}

export async function pollWatchedWallets(): Promise<WalletWatchEvent[]> {
  const events: WalletWatchEvent[] = [];

  for (const wallet of config.watchedWallets) {
    try {
      const txs = await fetchEnhancedTransactionsForWallet(wallet);

      for (const tx of txs) {
        if (!tx.signature) continue;
        if (seenSignatures.has(tx.signature)) continue;

        const buyEvent = extractBuyEvent(wallet, tx);
        const launchEvent = extractLaunchEvent(wallet, tx);

        if (buyEvent) {
          events.push(buyEvent);
          seenSignatures.add(tx.signature);
          continue;
        }

        if (launchEvent) {
          events.push(launchEvent);
          seenSignatures.add(tx.signature);
          continue;
        }
      }
    } catch (error) {
      console.error(`wallet watcher failed for ${wallet}`, error);
    }
  }

  return events;
}