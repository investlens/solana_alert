import {
  decodeEventLog,
  getAddress,
  parseAbiItem,
  type Address,
  type Hex,
} from 'viem';

import type { WalletWatchEvent } from '../../core/walletWatcher.js';
import { getActiveTrackedWalletAddresses, getTrackedWalletAddressesForChain } from '../../services/trackedWalletService.js';
import { supabase } from '../../services/supabase.js';
import { recordWalletTrade } from '../../agents/smartWalletAgent.js';
import { recordWalletBuy, recordWalletSell } from '../../agents/walletIntelligenceAgent.js';
import { getRobinhoodMarketSnapshot } from './market.js';
import { PONS_CONTRACTS } from './ponsContracts.js';
import { getRobinhoodLogsResilient, robinhoodPublicClient } from './rpc.js';
import { getRobinhoodTokenMetadata } from './tokenMetadata.js';

const transferEvent = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
);
const tokenLaunchedEvent = parseAbiItem(
  'event TokenLaunched(address indexed token, address indexed deployer, address indexed dexFactory, address pairToken, address pool, uint256 dexId, uint256 launchConfigId, uint256 positionId, uint256 restrictionsEndBlock, uint256 initialBuyAmount)',
);
const tokenLaunchedV2Event = parseAbiItem(
  'event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)',
);
const PONS_V2_LIVE_EMITTER = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e' as const;

const MAX_BLOCKS_PER_CYCLE = 250n;
export const MAX_HEALTHY_WALLET_CURSOR_LAG = 500n;
export const MAX_CATCH_UP_CHUNKS_PER_WALLET = 4;
export const MAX_CATCH_UP_CHUNKS_PER_POLL = 16;
export const ABANDONED_CURSOR_MIN_LAG = 100_000n;
export const ABANDONED_CURSOR_MIN_AGE_MS = 24 * 60 * 60 * 1_000;
const ADDRESS_BATCH_SIZE = 50;
const metadataCache = new Map<string, Awaited<ReturnType<typeof getRobinhoodTokenMetadata>>>();
const liveOnlyCursorInitialized = new Set<string>();

export type RobinhoodTransferEvidence = {
  token: Address;
  from: Address;
  to: Address;
  value: bigint;
};

export type RobinhoodTransactionEvidence = {
  hash: Hex;
  from: Address;
  value: bigint;
  transfers: RobinhoodTransferEvidence[];
  launchedTokens?: Address[];
};

export type RobinhoodActivityClassification = {
  kind: 'buy' | 'sell' | 'receive' | 'send' | 'launch';
  token: Address;
  amountRaw: bigint | null;
  evidence: string;
};

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isQuoteToken(token: string): boolean {
  return sameAddress(token, PONS_CONTRACTS.weth);
}

export function classifyRobinhoodWalletTransaction(
  wallet: Address,
  tx: RobinhoodTransactionEvidence,
): RobinhoodActivityClassification | null {
  const launched = tx.launchedTokens?.[0];
  if (launched) {
    return { kind: 'launch', token: launched, amountRaw: null, evidence: 'Verified PONS TokenLaunched deployer event' };
  }

  const received = tx.transfers.filter(transfer => sameAddress(transfer.to, wallet));
  const sent = tx.transfers.filter(transfer => sameAddress(transfer.from, wallet));
  const receivedAsset = received.find(transfer => !isQuoteToken(transfer.token));
  const sentAsset = sent.find(transfer => !isQuoteToken(transfer.token));
  const spentQuote = sent.some(transfer => isQuoteToken(transfer.token) && transfer.value > 0n);
  const receivedQuote = received.some(transfer => isQuoteToken(transfer.token) && transfer.value > 0n);
  const spentNative = sameAddress(tx.from, wallet) && tx.value > 0n;
  const routedQuoteMovement = sameAddress(tx.from, wallet)
    && tx.transfers.some(transfer => isQuoteToken(transfer.token) && transfer.value > 0n);

  if (receivedAsset && (spentQuote || spentNative || routedQuoteMovement)) {
    return {
      kind: 'buy', token: receivedAsset.token, amountRaw: receivedAsset.value,
      evidence: spentQuote
        ? 'Token received with verified quote-token spend'
        : spentNative
          ? 'Token received with verified native transaction value'
          : 'Token received in wallet-initiated transaction with verified routed WETH movement',
    };
  }
  if (sentAsset && receivedQuote) {
    return {
      kind: 'sell', token: sentAsset.token, amountRaw: sentAsset.value,
      evidence: 'Token sent with verified quote-token receipt',
    };
  }
  if (receivedAsset) return { kind: 'receive', token: receivedAsset.token, amountRaw: receivedAsset.value, evidence: 'Inbound ERC-20 transfer only' };
  if (sentAsset) return { kind: 'send', token: sentAsset.token, amountRaw: sentAsset.value, evidence: 'Outbound ERC-20 transfer only' };
  return null;
}

async function tokenMetadata(address: Address) {
  const key = address.toLowerCase();
  const cached = metadataCache.get(key);
  if (cached) return cached;
  const metadata = await getRobinhoodTokenMetadata(address);
  metadataCache.set(key, metadata);
  return metadata;
}

function normalizedAmount(raw: bigint | null, decimals: number | null): number | null {
  if (raw == null || decimals == null || decimals < 0 || decimals > 30) return null;
  const value = Number(raw) / (10 ** decimals);
  return Number.isFinite(value) ? value : null;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function indexedAddressFilter(batch: Address[]): Address | Address[] {
  return batch.length === 1 ? batch[0]! : batch;
}

function transferEvidenceFromReceipt(receipt: any): RobinhoodTransferEvidence[] {
  const transfers: RobinhoodTransferEvidence[] = [];
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: [transferEvent], data: log.data, topics: log.topics, strict: true });
      if (decoded.eventName !== 'Transfer') continue;
      const args = decoded.args as { from: Address; to: Address; value: bigint };
      transfers.push({ token: getAddress(log.address), from: getAddress(args.from), to: getAddress(args.to), value: args.value });
    } catch {}
  }
  return transfers;
}

async function persistRobinhoodWalletIntelligence(event: WalletWatchEvent): Promise<void> {
  if (!event.tokenMint || (event.kind !== 'buy' && event.kind !== 'sell')) return;

  if (event.kind === 'sell') {
    await recordWalletSell({ wallet: event.wallet, token: event.tokenMint });
    await recordWalletTrade({ wallet: event.wallet, token: event.tokenMint, action: 'SELL' });
    return;
  }

  let marketCapAtAction: number | null = null;
  let entryPrice: number | null = null;
  let entryLiquidity: number | null = null;

  try {
    const market = await getRobinhoodMarketSnapshot(event.tokenMint, {
      priority: 'HIGH',
      caller: 'robinhood_wallet_intelligence',
    });
    marketCapAtAction = market?.marketCapUsd ?? null;
    entryPrice = market?.priceUsd ?? null;
    entryLiquidity = market?.liquidityUsd ?? null;
    event.marketCap = marketCapAtAction;
    event.liquidity = entryLiquidity;
    event.volume5m = market?.volume5mUsd ?? null;
    event.tokenSymbol = market?.symbol ?? event.tokenSymbol;
    event.tokenName = market?.name ?? event.tokenName;
  } catch (error) {
    console.warn('[RobinhoodWalletIntel] market enrichment unavailable', {
      wallet: event.wallet,
      token: event.tokenMint,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  await recordWalletBuy({ wallet: event.wallet, token: event.tokenMint, amountSol: null });
  await recordWalletTrade({
    wallet: event.wallet,
    token: event.tokenMint,
    action: 'BUY',
    amountSol: null,
    marketCapAtAction,
    entryPrice,
    entryLiquidity,
  });
}

export async function scanRobinhoodWalletActivity(args: {
  wallets: Address[];
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<WalletWatchEvent[]> {
  if (!args.wallets.length || args.fromBlock > args.toBlock) return [];
  const transferLogs: any[] = [];
  for (const batch of chunks(args.wallets, ADDRESS_BATCH_SIZE)) {
    const walletFilter = indexedAddressFilter(batch);
    const [outgoing, incoming] = await Promise.all([
      getRobinhoodLogsResilient({ event: transferEvent, args: { from: walletFilter }, fromBlock: args.fromBlock, toBlock: args.toBlock }),
      getRobinhoodLogsResilient({ event: transferEvent, args: { to: walletFilter }, fromBlock: args.fromBlock, toBlock: args.toBlock }),
    ]);
    transferLogs.push(...outgoing, ...incoming);
  }
  const launchLogs: any[] = [];
  for (const batch of chunks(args.wallets, ADDRESS_BATCH_SIZE)) {
    const deployerFilter = indexedAddressFilter(batch);
    const [v1LaunchLogs, v2LaunchLogs] = await Promise.all([
      getRobinhoodLogsResilient({ address: getAddress(PONS_CONTRACTS.factory), event: tokenLaunchedEvent, args: { deployer: deployerFilter }, fromBlock: args.fromBlock, toBlock: args.toBlock }),
      getRobinhoodLogsResilient({ address: getAddress(PONS_V2_LIVE_EMITTER), event: tokenLaunchedV2Event, args: { deployer: deployerFilter }, fromBlock: args.fromBlock, toBlock: args.toBlock }),
    ]);
    launchLogs.push(...v1LaunchLogs, ...v2LaunchLogs);
  }

  const txHashes = new Set<Hex>();
  for (const log of [...transferLogs, ...launchLogs]) if (log.transactionHash) txHashes.add(log.transactionHash);
  const events: WalletWatchEvent[] = [];
  for (const hash of txHashes) {
    const [transaction, receipt] = await Promise.all([
      robinhoodPublicClient.getTransaction({ hash }),
      robinhoodPublicClient.getTransactionReceipt({ hash }),
    ]);
    const transfers = transferEvidenceFromReceipt(receipt);
    const block = await robinhoodPublicClient.getBlock({ blockNumber: receipt.blockNumber });
    for (const wallet of args.wallets) {
      const launchedTokens = launchLogs.filter(log => log.transactionHash === hash && log.args.deployer && sameAddress(log.args.deployer, wallet))
        .flatMap(log => log.args.token ? [getAddress(log.args.token)] : []);
      const classification = classifyRobinhoodWalletTransaction(wallet, {
        hash, from: getAddress(transaction.from), value: transaction.value, transfers, launchedTokens,
      });
      if (!classification) continue;
      const metadata = await tokenMetadata(classification.token).catch(() => null);
      const assetTransfer = transfers.find(transfer => sameAddress(transfer.token, classification.token) &&
        (sameAddress(transfer.to, wallet) || sameAddress(transfer.from, wallet)));
      const directQuoteTransfer = transfers.find(transfer => isQuoteToken(transfer.token) &&
        (sameAddress(transfer.to, wallet) || sameAddress(transfer.from, wallet)));
      const routedQuoteTransfer = classification.kind === 'buy'
        ? transfers.find(transfer => isQuoteToken(transfer.token) && transfer.value > 0n) : null;
      const quoteTransfer = directQuoteTransfer ?? routedQuoteTransfer;
      const nativeAmount = (classification.kind === 'buy' && sameAddress(transaction.from, wallet) && transaction.value > 0n)
        ? Number(transaction.value) / 1e18 : null;
      const quoteAmount = quoteTransfer ? Number(quoteTransfer.value) / 1e18 : null;
      const event = {
        kind: classification.kind, chain: 'robinhood', wallet, signature: hash,
        timestamp: Number(block.timestamp), blockNumber: Number(receipt.blockNumber), tokenMint: classification.token,
        tokenAmount: normalizedAmount(classification.amountRaw, metadata?.decimals ?? null),
        tokenAmountRaw: classification.amountRaw?.toString() ?? null, tokenDecimals: metadata?.decimals ?? null,
        tokenSymbol: metadata?.symbol ?? null, tokenName: metadata?.name ?? null,
        nativeAmount: nativeAmount ?? quoteAmount, quoteSymbol: nativeAmount != null ? 'ETH' : quoteTransfer ? 'WETH' : null,
        counterparty: assetTransfer ? (sameAddress(assetTransfer.to, wallet) ? assetTransfer.from : assetTransfer.to) : null,
        type: classification.evidence,
        ...(classification.kind === 'buy' || classification.kind === 'sell' ? { amountSol: null } : {}),
      } as WalletWatchEvent;
      await persistRobinhoodWalletIntelligence(event).catch(error => console.warn('[RobinhoodWalletIntel] persistence failed', {
        wallet: event.wallet, token: event.tokenMint, kind: event.kind,
        reason: error instanceof Error ? error.message : String(error),
      }));
      events.push(event);
    }
  }
  return events;
}

type StoredWalletCursor = { block: bigint; updatedAt: Date };

async function initializeMissingCursors(wallets: Address[], latest: bigint): Promise<Map<string, StoredWalletCursor>> {
  const { data, error } = await supabase.from('wallet_monitor_cursors').select('wallet_address,last_processed_block,updated_at').eq('chain', 'robinhood');
  if (error) throw error;
  const cursors = new Map((data ?? []).map(row => [String(row.wallet_address).toLowerCase(), {
    block: BigInt(row.last_processed_block), updatedAt: new Date(String(row.updated_at)),
  }]));
  const missing = wallets.filter(wallet => !cursors.has(wallet.toLowerCase()));
  if (missing.length) {
    const { error: insertError } = await supabase.from('wallet_monitor_cursors').upsert(
      missing.map(wallet => ({ chain: 'robinhood', wallet_address: wallet, last_processed_block: latest.toString() })),
      { onConflict: 'chain,wallet_address' },
    );
    if (insertError) throw insertError;
    const initializedAt = new Date();
    for (const wallet of missing) cursors.set(wallet.toLowerCase(), { block: latest, updatedAt: initializedAt });
  }
  return cursors;
}

export type WalletCursorHealth = 'HEALTHY' | 'CATCHING_UP' | 'STALE' | 'BLOCKED';
export function walletCursorRecoveryDecision(args: {
  cursor: bigint; chainHead: bigint; unresolvedDeliveries: number; cursorUpdatedAt?: Date; now?: Date;
}) {
  const lag = args.chainHead > args.cursor ? args.chainHead - args.cursor : 0n;
  if (lag === 0n) return { health: 'HEALTHY' as const, rebase: false, lag };
  if (args.unresolvedDeliveries > 0) return { health: 'BLOCKED' as const, rebase: false, lag };
  const ageMs = args.cursorUpdatedAt == null ? 0 : (args.now ?? new Date()).getTime() - args.cursorUpdatedAt.getTime();
  const abandoned = lag >= ABANDONED_CURSOR_MIN_LAG && ageMs >= ABANDONED_CURSOR_MIN_AGE_MS;
  return abandoned ? { health: 'STALE' as const, rebase: true, lag } : { health: 'CATCHING_UP' as const, rebase: false, lag };
}

async function unresolvedWalletDeliveries(wallets: Address[]): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('wallet_activity_deliveries')
    .select('wallet_address,metadata,delivered_at').in('metadata->>state', ['RESERVED', 'SENT_UNCONFIRMED']);
  if (error) throw error;
  const monitored = new Set(wallets.map(wallet => wallet.toLowerCase()));
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const key = String(row.wallet_address).toLowerCase();
    const state = (row.metadata as Record<string, unknown> | null)?.state;
    if (row.delivered_at != null) continue;
    if (monitored.has(key) && (state === 'RESERVED' || state === 'SENT_UNCONFIRMED')) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export type RobinhoodWalletChunkProcessor = (events: WalletWatchEvent[]) => Promise<{ failedWallets: Set<string> }>;

export async function pollRobinhoodTrackedWallets(processChunk: RobinhoodWalletChunkProcessor): Promise<{
  events: WalletWatchEvent[]; checkpointBlocks: Map<string, bigint>; wallets: Address[];
}> {
  const allWallets = [...new Map((await getTrackedWalletAddressesForChain('robinhood'))
    .map(value => getAddress(value)).map(wallet => [wallet.toLowerCase(), wallet])).values()];
  if (!allWallets.length) return { events: [], checkpointBlocks: new Map(), wallets: [] };
  const wallets = [...new Map((await getActiveTrackedWalletAddresses('robinhood'))
    .map(value => getAddress(value)).map(wallet => [wallet.toLowerCase(), wallet])).values()];
  const latest = await robinhoodPublicClient.getBlockNumber();
  const cursors = await initializeMissingCursors(allWallets, latest);

  // Production live-only safety:
  // On the first poll after each process start, existing Robinhood wallet cursors
  // are rebased to the current head instead of replaying historical blocks.
  // This avoids archive-RPC requirements and prevents catch-up traffic storms.
  const firstRuntimePoll = wallets.filter(wallet => !liveOnlyCursorInitialized.has(wallet.toLowerCase()));
  if (firstRuntimePoll.length) {
    await commitRobinhoodWalletCheckpoints(firstRuntimePoll, latest);
    const initializedAt = new Date();
    for (const wallet of firstRuntimePoll) {
      const key = wallet.toLowerCase();
      cursors.set(key, { block: latest, updatedAt: initializedAt });
      liveOnlyCursorInitialized.add(key);
    }
    console.log('[RobinhoodWalletWatcher] LIVE_ONLY cursors initialized at chain head', {
      wallets: firstRuntimePoll.length,
      chainHead: latest.toString(),
    });
  }

  const activeKeys = new Set(wallets.map(wallet => wallet.toLowerCase()));
  const pausedWallets = allWallets.filter(wallet => !activeKeys.has(wallet.toLowerCase()));
  if (pausedWallets.length) await commitRobinhoodWalletCheckpoints(pausedWallets, latest);
  const existingWallets = wallets.filter(wallet => cursors.has(wallet.toLowerCase()));
  if (!existingWallets.length) return { events: [], checkpointBlocks: new Map(), wallets: [] };
  const unresolved = await unresolvedWalletDeliveries(existingWallets);
  const events: WalletWatchEvent[] = [];
  const checkpointBlocks = new Map<string, bigint>();
  const scannedWallets: Address[] = [];
  const workingCursors = new Map([...cursors].map(([key, value]) => [key, value.block]));
  const chunksScanned = new Map<string, number>();
  let totalChunks = 0;
  let pending = [...existingWallets];

  while (pending.length && totalChunks < MAX_CATCH_UP_CHUNKS_PER_POLL) {
    const nextRound: Address[] = [];
    for (const wallet of pending) {
      if (totalChunks >= MAX_CATCH_UP_CHUNKS_PER_POLL) break;
      const key = wallet.toLowerCase();
      const stored = cursors.get(key)!;
      const cursor = workingCursors.get(key)!;
      const recovery = walletCursorRecoveryDecision({ cursor, chainHead: latest, unresolvedDeliveries: unresolved.get(key) ?? 0, cursorUpdatedAt: stored.updatedAt });
      if (recovery.rebase) {
        await commitRobinhoodWalletCheckpoints([wallet], latest);
        console.warn('[RobinhoodWalletWatcher] Rebased abandoned cursor without historical replay', {
          wallet, previousCursor: cursor.toString(), chainHead: latest.toString(), lag: recovery.lag.toString(),
        });
        continue;
      }
      if (cursor >= latest || recovery.health === 'BLOCKED') continue;
      const fromBlock = cursor + 1n;
      const toBlock = fromBlock + MAX_BLOCKS_PER_CYCLE - 1n < latest ? fromBlock + MAX_BLOCKS_PER_CYCLE - 1n : latest;
      const walletEvents = (await scanRobinhoodWalletActivity({ wallets: [wallet], fromBlock, toBlock }))
        .filter(event => eventIsAfterWalletCursor(event, workingCursors));
      events.push(...walletEvents);
      totalChunks += 1;
      const count = (chunksScanned.get(key) ?? 0) + 1;
      chunksScanned.set(key, count);
      const delivery = await processChunk(walletEvents);
      if (delivery.failedWallets.has(key)) continue;
      await commitRobinhoodWalletCheckpoints([wallet], toBlock);
      workingCursors.set(key, toBlock);
      checkpointBlocks.set(key, toBlock);
      scannedWallets.push(wallet);
      if (toBlock < latest && count < MAX_CATCH_UP_CHUNKS_PER_WALLET) nextRound.push(wallet);
    }
    pending = nextRound;
  }
  return { events, checkpointBlocks, wallets: [...new Map(scannedWallets.map(wallet => [wallet.toLowerCase(), wallet])).values()] };
}

export function eventIsAfterWalletCursor(event: WalletWatchEvent, cursors: Map<string, bigint>): boolean {
  const cursor = cursors.get(event.wallet.toLowerCase());
  return cursor != null && BigInt(event.blockNumber ?? 0) > cursor;
}

export function walletsEligibleForCheckpoint(wallets: Address[], cursors: Map<string, bigint>, block: bigint): Address[] {
  return wallets.filter(wallet => (cursors.get(wallet.toLowerCase()) ?? block) < block);
}

export async function commitRobinhoodWalletCheckpoints(wallets: Address[], block: bigint): Promise<void> {
  if (!wallets.length) return;
  const { error } = await supabase.from('wallet_monitor_cursors').upsert(
    wallets.map(wallet => ({ chain: 'robinhood', wallet_address: wallet, last_processed_block: block.toString(), updated_at: new Date().toISOString() })),
    { onConflict: 'chain,wallet_address' },
  );
  if (error) throw error;
}

export async function initializeRobinhoodWalletCursorAtCurrentBlock(wallet: Address): Promise<bigint> {
  const currentBlock = await robinhoodPublicClient.getBlockNumber();
  const { error } = await supabase.from('wallet_monitor_cursors').upsert(
    [{ chain: 'robinhood', wallet_address: wallet, last_processed_block: currentBlock.toString() }],
    { onConflict: 'chain,wallet_address', ignoreDuplicates: true },
  );
  if (error) throw error;
  return currentBlock;
}


type BlockscoutAddress = { hash?: string };
type BlockscoutTransaction = {
  hash?: string;
  block_number?: number | string;
  timestamp?: string;
  from?: BlockscoutAddress | string | null;
  to?: BlockscoutAddress | string | null;
  value?: string | number | null;
  status?: string | null;
  method?: string | null;
};
type BlockscoutTransfer = {
  from?: BlockscoutAddress | string | null;
  to?: BlockscoutAddress | string | null;
  token?: Record<string, unknown> | null;
  total?: Record<string, unknown> | null;
  value?: string | number | null;
};

const ROBINHOOD_EXPLORER_BASE_URL = String(
  process.env.ROBINHOOD_WALLET_EXPLORER_BASE_URL ??
  'https://robinhoodchain.blockscout.com/api/v2',
).replace(/\/$/, '');
const ROBINHOOD_EXPLORER_TIMEOUT_MS = Math.max(
  2_000,
  Math.min(15_000, Number(process.env.ROBINHOOD_WALLET_EXPLORER_TIMEOUT_MS ?? 6_000)),
);
const ROBINHOOD_EXPLORER_MAX_TX_PER_WALLET = Math.max(
  5,
  Math.min(50, Number(process.env.ROBINHOOD_WALLET_EXPLORER_MAX_TX ?? 50)),
);

function blockscoutAddress(value: BlockscoutAddress | string | null | undefined): string | null {
  if (typeof value === 'string') return /^0x[a-fA-F0-9]{40}$/.test(value) ? value : null;
  const hash = String(value?.hash ?? '');
  return /^0x[a-fA-F0-9]{40}$/.test(hash) ? hash : null;
}

function blockscoutBigInt(value: unknown): bigint {
  try {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
    const text = String(value ?? '').trim();
    return text ? BigInt(text) : 0n;
  } catch {
    return 0n;
  }
}

async function blockscoutJson<T>(path: string): Promise<T> {
  const response = await fetch(
    `${ROBINHOOD_EXPLORER_BASE_URL}${path}`,
    { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(ROBINHOOD_EXPLORER_TIMEOUT_MS) },
  );
  if (!response.ok) throw new Error(`Blockscout HTTP ${response.status}`);
  return await response.json() as T;
}

async function explorerTransactions(wallet: Address): Promise<BlockscoutTransaction[]> {
  const payload = await blockscoutJson<{ items?: BlockscoutTransaction[] }>(
    `/addresses/${encodeURIComponent(wallet)}/transactions?filter=from`,
  );
  return Array.isArray(payload.items)
    ? payload.items.slice(0, ROBINHOOD_EXPLORER_MAX_TX_PER_WALLET)
    : [];
}

function explorerTokenAddress(transfer: BlockscoutTransfer): string | null {
  const token = transfer.token ?? {};
  for (const candidate of [
    token.address,
    token.address_hash,
    token.contract_address,
    token.contract_address_hash,
    (transfer as any).token_address,
  ]) {
    const value = String(candidate ?? '');
    if (/^0x[a-fA-F0-9]{40}$/.test(value)) return value;
  }
  return null;
}

function explorerTransferValue(transfer: BlockscoutTransfer): bigint {
  const total = transfer.total ?? {};
  for (const candidate of [
    total.value,
    (transfer as any).value,
    (transfer as any).amount,
  ]) {
    const parsed = blockscoutBigInt(candidate);
    if (parsed > 0n) return parsed;
  }
  return 0n;
}

function explorerTransferDecimals(transfer: BlockscoutTransfer): number | null {
  const token = transfer.token ?? {};
  const total = transfer.total ?? {};
  for (const candidate of [token.decimals, total.decimals, (transfer as any).decimals]) {
    const parsed = Number(candidate);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 30) return parsed;
  }
  return null;
}

function explorerTransferSymbol(transfer: BlockscoutTransfer): string | null {
  const token = transfer.token ?? {};
  const value = String(token.symbol ?? '').trim();
  return value || null;
}

async function explorerTransfers(hash: Hex): Promise<BlockscoutTransfer[]> {
  const payload = await blockscoutJson<{ items?: BlockscoutTransfer[] }>(
    `/transactions/${encodeURIComponent(hash)}/token-transfers?type=ERC-20`,
  );
  return Array.isArray(payload.items) ? payload.items : [];
}

function explorerTimestampSeconds(value: unknown): number {
  const millis = Date.parse(String(value ?? ''));
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : Math.floor(Date.now() / 1000);
}

async function explorerCursorMap(wallets: Address[]): Promise<Map<string, bigint>> {
  const { data, error } = await supabase
    .from('wallet_monitor_cursors')
    .select('wallet_address,last_processed_block')
    .eq('chain', 'robinhood');
  if (error) throw error;
  const monitored = new Set(wallets.map(wallet => wallet.toLowerCase()));
  return new Map(
    (data ?? [])
      .filter(row => monitored.has(String(row.wallet_address).toLowerCase()))
      .map(row => [String(row.wallet_address).toLowerCase(), BigInt(row.last_processed_block ?? 0)]),
  );
}

async function explorerTrackedSinceMap(wallets: Address[]): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('user_tracked_wallets')
    .select('wallet_address,created_at')
    .eq('chain', 'robinhood')
    .eq('is_active', true);
  if (error) throw error;
  const monitored = new Set(wallets.map(wallet => wallet.toLowerCase()));
  const result = new Map<string, number>();
  for (const row of data ?? []) {
    const key = String(row.wallet_address).toLowerCase();
    if (!monitored.has(key)) continue;
    const time = Date.parse(String(row.created_at ?? ''));
    if (!Number.isFinite(time)) continue;
    const previous = result.get(key);
    if (previous == null || time < previous) result.set(key, time);
  }
  return result;
}

async function explorerWalletEvents(
  wallet: Address,
  transactions: BlockscoutTransaction[],
  cursor: bigint,
  trackedSinceMs: number | null,
): Promise<{ events: WalletWatchEvent[]; maxBlock: bigint }> {
  const events: WalletWatchEvent[] = [];
  let maxBlock = cursor;

  // Blockscout returns newest first. Process oldest first so Telegram activity
  // arrives in chronological order when recovering a short gap.
  const ordered = [...transactions].reverse();
  for (const tx of ordered) {
    const blockNumber = blockscoutBigInt(tx.block_number);
    if (blockNumber <= cursor) continue;
    const txTimeMs = Date.parse(String(tx.timestamp ?? ''));
    if (cursor === 0n && trackedSinceMs != null && Number.isFinite(txTimeMs) && txTimeMs < trackedSinceMs) continue;
    if (String(tx.status ?? 'ok').toLowerCase() === 'error') {
      if (blockNumber > maxBlock) maxBlock = blockNumber;
      continue;
    }
    const hashText = String(tx.hash ?? '');
    const fromText = blockscoutAddress(tx.from);
    if (!/^0x[a-fA-F0-9]{64}$/.test(hashText) || !fromText || !sameAddress(fromText, wallet)) {
      if (blockNumber > maxBlock) maxBlock = blockNumber;
      continue;
    }

    const hash = hashText as Hex;
    const rawTransfers = await explorerTransfers(hash);
    const transferMeta = new Map<string, { decimals: number | null; symbol: string | null }>();
    const transfers: RobinhoodTransferEvidence[] = [];
    for (const transfer of rawTransfers) {
      const token = explorerTokenAddress(transfer);
      const from = blockscoutAddress(transfer.from);
      const to = blockscoutAddress(transfer.to);
      if (!token || !from || !to) continue;
      const normalizedToken = getAddress(token);
      transfers.push({
        token: normalizedToken,
        from: getAddress(from),
        to: getAddress(to),
        value: explorerTransferValue(transfer),
      });
      transferMeta.set(normalizedToken.toLowerCase(), {
        decimals: explorerTransferDecimals(transfer),
        symbol: explorerTransferSymbol(transfer),
      });
    }

    const classification = classifyRobinhoodWalletTransaction(wallet, {
      hash,
      from: getAddress(fromText),
      value: blockscoutBigInt(tx.value),
      transfers,
    });
    if (classification) {
      const meta = transferMeta.get(classification.token.toLowerCase());
      const tokenDecimals = meta?.decimals ?? null;
      const quoteTransfer = transfers.find(transfer =>
        isQuoteToken(transfer.token) &&
        (sameAddress(transfer.to, wallet) || sameAddress(transfer.from, wallet) || classification.kind === 'buy'));
      const nativeRaw = blockscoutBigInt(tx.value);
      const nativeAmount = classification.kind === 'buy' && nativeRaw > 0n
        ? Number(nativeRaw) / 1e18
        : quoteTransfer
          ? Number(quoteTransfer.value) / 1e18
          : null;

      events.push({
        kind: classification.kind,
        chain: 'robinhood',
        wallet,
        signature: hash,
        timestamp: explorerTimestampSeconds(tx.timestamp),
        blockNumber: Number(blockNumber),
        tokenMint: classification.token,
        tokenAmount: normalizedAmount(classification.amountRaw, tokenDecimals),
        tokenAmountRaw: classification.amountRaw?.toString() ?? null,
        tokenDecimals,
        tokenSymbol: meta?.symbol ?? null,
        tokenName: null,
        nativeAmount,
        quoteSymbol: nativeRaw > 0n ? 'ETH' : quoteTransfer ? 'WETH' : null,
        counterparty: blockscoutAddress(tx.to),
        type: `Blockscout live wallet activity: ${classification.evidence}`,
        ...(classification.kind === 'buy' || classification.kind === 'sell' ? { amountSol: null } : {}),
      } as WalletWatchEvent);
    }
    if (blockNumber > maxBlock) maxBlock = blockNumber;
  }

  return { events, maxBlock };
}

/**
 * Lean Robinhood wallet watcher.
 *
 * The chain produces blocks too quickly for range-based eth_getLogs polling.
 * Blockscout already indexes address activity, so this path performs one
 * address-transaction request per active wallet and only fetches token transfers
 * when a new outgoing transaction exists.
 */
export async function pollRobinhoodTrackedWalletsExplorer(
  processChunk: RobinhoodWalletChunkProcessor,
): Promise<{ events: WalletWatchEvent[]; checkpointBlocks: Map<string, bigint>; wallets: Address[] }> {
  const wallets = [...new Map((await getActiveTrackedWalletAddresses('robinhood'))
    .map(value => getAddress(value))
    .map(wallet => [wallet.toLowerCase(), wallet])).values()];
  if (!wallets.length) return { events: [], checkpointBlocks: new Map(), wallets: [] };

  const cursors = await explorerCursorMap(wallets);
  const trackedSince = await explorerTrackedSinceMap(wallets);
  const events: WalletWatchEvent[] = [];
  const checkpointBlocks = new Map<string, bigint>();
  const scannedWallets: Address[] = [];

  for (const wallet of wallets) {
    const key = wallet.toLowerCase();
    try {
      const transactions = await explorerTransactions(wallet);
      const cursor = cursors.get(key) ?? 0n;
      const scanned = await explorerWalletEvents(wallet, transactions, cursor, trackedSince.get(key) ?? null);
      events.push(...scanned.events);

      const delivery = await processChunk(scanned.events);
      if (delivery.failedWallets.has(key)) {
        console.warn('[RobinhoodWalletExplorer] delivery failed; cursor held', {
          wallet,
          events: scanned.events.length,
        });
        continue;
      }

      if (scanned.maxBlock > cursor) {
        await commitRobinhoodWalletCheckpoints([wallet], scanned.maxBlock);
        checkpointBlocks.set(key, scanned.maxBlock);
      }
      scannedWallets.push(wallet);
      if (scanned.events.length > 0) {
        console.log('[RobinhoodWalletExplorer] activity processed', {
          wallet,
          events: scanned.events.length,
          throughBlock: scanned.maxBlock.toString(),
        });
      }
    } catch (error) {
      console.warn('[RobinhoodWalletExplorer] wallet poll failed', {
        wallet,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { events, checkpointBlocks, wallets: scannedWallets };
}
