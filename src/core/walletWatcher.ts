import { config } from '../config.js';
import { recordWhaleHit } from '../engines/whaleClusterEngine.js';
import { recordWalletTrade } from '../agents/smartWalletAgent.js';
import {
  recordWalletBuy,
  recordWalletSell,
} from '../agents/walletIntelligenceAgent.js';

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
      kind: 'sell';
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

type WalletBuyEvent = Extract<WalletWatchEvent, { kind: 'buy' }>;
type WalletSellEvent = Extract<WalletWatchEvent, { kind: 'sell' }>;
type WalletLaunchEvent = Extract<WalletWatchEvent, { kind: 'launch' }>;

const seenSignatures = new Set<string>();
const walletBackoffUntil = new Map<string, number>();

const tokenBuyerMap = new Map<string, Set<string>>();

function now() {
  return Date.now();
}

async function fetchEnhancedTransactionsForWallet(wallet: string): Promise<EnhancedTx[]> {
  if (!config.heliusApiKey) return [];

  const backoffUntil = walletBackoffUntil.get(wallet) ?? 0;

  if (backoffUntil > now()) {
    const waitSec = Math.ceil((backoffUntil - now()) / 1000);
    console.log(`wallet watcher backoff active for ${wallet}: ${waitSec}s remaining`);
    return [];
  }

  const url = `https://api-mainnet.helius-rpc.com/v0/addresses/${wallet}/transactions?api-key=${config.heliusApiKey}&limit=10`;

  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text().catch(() => '');

    if (res.status === 429) {
      walletBackoffUntil.set(wallet, now() + 5 * 60 * 1000);
      console.log(`wallet watcher 429 for ${wallet}, backing off 5 minutes`);
      return [];
    }

    throw new Error(`Helius wallet tx fetch failed ${res.status}: ${text}`);
  }

  return (await res.json()) as EnhancedTx[];
}

function lamportsToSol(lamports?: number): number | null {
  if (lamports == null || !Number.isFinite(lamports)) return null;
  return lamports / 1_000_000_000;
}

function getLargestSolOutflowFromWallet(wallet: string, tx: EnhancedTx): number | null {
  const candidates =
    tx.nativeTransfers
      ?.filter(
        (n) =>
          n.fromUserAccount === wallet &&
          typeof n.amount === 'number' &&
          Number.isFinite(n.amount) &&
          n.amount > 0
      )
      .map((n) => n.amount as number) ?? [];

  if (!candidates.length) return null;
  return Math.max(...candidates);
}

function getLargestSolInflowToWallet(wallet: string, tx: EnhancedTx): number | null {
  const candidates =
    tx.nativeTransfers
      ?.filter(
        (n) =>
          n.toUserAccount === wallet &&
          typeof n.amount === 'number' &&
          Number.isFinite(n.amount) &&
          n.amount > 0
      )
      .map((n) => n.amount as number) ?? [];

  if (!candidates.length) return null;
  return Math.max(...candidates);
}

function isIgnoredTokenMint(mint?: string | null) {
  if (!mint) return true;

  const ignored = new Set([
    'So11111111111111111111111111111111111111112', // WSOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY7sc5uM8dDuLzz', // USDT
  ]);

  return ignored.has(mint);
}

function extractBuyEvent(wallet: string, tx: EnhancedTx): WalletBuyEvent | null {
  const type = tx.type ?? 'UNKNOWN';
  if (!['SWAP', 'BUY'].includes(type)) return null;

  const receivedToken = tx.tokenTransfers?.find(
    (t) =>
      t.toUserAccount === wallet &&
      t.mint &&
      !isIgnoredTokenMint(t.mint)
  );

  const tokenMint = receivedToken?.mint ?? null;

  if (!tokenMint) return null;

  const amountLamports = getLargestSolOutflowFromWallet(wallet, tx);
  const amountSol = lamportsToSol(amountLamports ?? undefined);

  return {
    kind: 'buy',
    wallet,
    signature: tx.signature ?? '',
    timestamp: tx.timestamp,
    tokenMint,
    amountSol: amountSol != null && amountSol >= 0.001 ? amountSol : null,
    type,
  };
}

function extractSellEvent(wallet: string, tx: EnhancedTx): WalletSellEvent | null {
  const type = tx.type ?? 'UNKNOWN';
  if (!['SWAP', 'SELL'].includes(type)) return null;

  const soldTokenTransfer = tx.tokenTransfers?.find(
  (t) =>
    t.fromUserAccount === wallet &&
    t.mint &&
    !isIgnoredTokenMint(t.mint)
  );

  if (!soldTokenTransfer?.mint) return null;

  const receivedLamports = getLargestSolInflowToWallet(wallet, tx);
  const amountSol = lamportsToSol(receivedLamports ?? undefined);

  return {
    kind: 'sell',
    wallet,
    signature: tx.signature ?? '',
    timestamp: tx.timestamp,
    tokenMint: soldTokenTransfer.mint,
    amountSol: amountSol != null && amountSol >= 0.001 ? amountSol : null,
    type,
  };
}

function extractLaunchEvent(wallet: string, tx: EnhancedTx): WalletLaunchEvent | null {
  const type = tx.type ?? 'UNKNOWN';
  const description = (tx.description ?? '').toLowerCase();

  const possibleLaunchTypes = ['TOKEN_MINT', 'CREATE_POOL', 'CREATE_ACCOUNT'];

  const tokenMint = tx.tokenTransfers?.find((t) => t.mint)?.mint ?? null;

  const looksLikeLaunchByText =
    description.includes('mint') ||
    description.includes('created token') ||
    description.includes('create pool') ||
    description.includes('launched');

  const walletInvolvedInTokenMovement =
    tx.tokenTransfers?.some(
      (t) => t.toUserAccount === wallet || t.fromUserAccount === wallet
    ) ?? false;

  if (
    possibleLaunchTypes.includes(type) ||
    (looksLikeLaunchByText && tokenMint) ||
    (type === 'UNKNOWN' && walletInvolvedInTokenMovement && tokenMint)
  ) {
    if (!tokenMint) return null;

    return {
      kind: 'launch',
      wallet,
      signature: tx.signature ?? '',
      timestamp: tx.timestamp,
      tokenMint,
      type,
    };
  }

  return null;
}

export async function pollWatchedWallets(): Promise<WalletWatchEvent[]> {
  const events: WalletWatchEvent[] = [];

  for (const wallet of config.watchedWallets) {
    try {
      const txs = await fetchEnhancedTransactionsForWallet(wallet);

      for (const tx of txs) {
        if (!tx.signature) continue;
        if (seenSignatures.has(tx.signature)) continue;

        console.log('wallet tx debug:', {
          wallet,
          signature: tx.signature,
          type: tx.type,
          description: tx.description,
        });

        const buyEvent = extractBuyEvent(wallet, tx);
        const sellEvent = extractSellEvent(wallet, tx);
        const launchEvent = extractLaunchEvent(wallet, tx);

        if (buyEvent) {
          if (buyEvent.tokenMint) {
          const set = tokenBuyerMap.get(buyEvent.tokenMint) ?? new Set<string>();
          set.add(wallet);
          tokenBuyerMap.set(buyEvent.tokenMint, set);
        }

          console.log('wallet buy detected:', {
            wallet,
            signature: tx.signature,
            type: tx.type,
            tokenMint: buyEvent.tokenMint,
            amountSol: buyEvent.amountSol,
          });

          recordWhaleHit({
            wallet,
            token: buyEvent.tokenMint ?? '',
            symbol: 'Unknown',
            usdSize: Number(buyEvent.amountSol ?? 0) * 150,
            timestamp: Date.now(),
          });

          await recordWalletBuy({
            wallet,
            token: buyEvent.tokenMint ?? '',
            amountSol: buyEvent.amountSol,
          });

          await recordWalletTrade({
            wallet,
            token: buyEvent.tokenMint ?? '',
            action: 'BUY',
            amountSol: buyEvent.amountSol,
          });

          events.push(buyEvent);
          seenSignatures.add(tx.signature);
          continue;
        }

        if (sellEvent) {
          console.log('wallet sell detected:', {
            wallet,
            signature: tx.signature,
            type: tx.type,
            tokenMint: sellEvent.tokenMint,
            amountSol: sellEvent.amountSol,
          });

          await recordWalletSell({
            wallet,
            token: sellEvent.tokenMint,
          });

          await recordWalletTrade({
            wallet,
            token: sellEvent.tokenMint ?? '',
            action: 'SELL',
            amountSol: sellEvent.amountSol,
          });

          events.push(sellEvent);
          seenSignatures.add(tx.signature);
          continue;
        }

        if (launchEvent) {
          console.log('launch detected:', {
            wallet,
            signature: tx.signature,
            type: tx.type,
            tokenMint: launchEvent.tokenMint,
            description: tx.description,
          });

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

export function getTokenBuyers(token: string): string[] {
  return [...(tokenBuyerMap.get(token) ?? new Set())];
}