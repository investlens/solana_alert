import {
  getAddress,
  parseAbiItem,
  type Address,
  type Hex,
} from 'viem';

import type { WalletWatchEvent } from '../../core/walletWatcher.js';
import { getActiveTrackedWalletAddresses, getTrackedWalletAddressesForChain } from '../../services/trackedWalletService.js';
import { supabase } from '../../services/supabase.js';
import { PONS_CONTRACTS } from './ponsContracts.js';
import { robinhoodPublicClient } from './rpc.js';
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
const ADDRESS_BATCH_SIZE = 50;
const metadataCache = new Map<string, Awaited<ReturnType<typeof getRobinhoodTokenMetadata>>>();

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

  if (receivedAsset && (spentQuote || spentNative)) {
    return {
      kind: 'buy', token: receivedAsset.token, amountRaw: receivedAsset.value,
      evidence: spentQuote ? 'Token received with verified quote-token spend' : 'Token received with verified native transaction value',
    };
  }
  if (sentAsset && receivedQuote) {
    return {
      kind: 'sell', token: sentAsset.token, amountRaw: sentAsset.value,
      evidence: 'Token sent with verified quote-token receipt',
    };
  }
  if (receivedAsset) {
    return { kind: 'receive', token: receivedAsset.token, amountRaw: receivedAsset.value, evidence: 'Inbound ERC-20 transfer only' };
  }
  if (sentAsset) {
    return { kind: 'send', token: sentAsset.token, amountRaw: sentAsset.value, evidence: 'Outbound ERC-20 transfer only' };
  }
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

export async function scanRobinhoodWalletActivity(args: {
  wallets: Address[];
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<WalletWatchEvent[]> {
  if (!args.wallets.length || args.fromBlock > args.toBlock) return [];
  const transferLogs: any[] = [];
  for (const batch of chunks(args.wallets, ADDRESS_BATCH_SIZE)) {
    const [outgoing, incoming] = await Promise.all([
      robinhoodPublicClient.getLogs({ event: transferEvent, args: { from: batch }, fromBlock: args.fromBlock, toBlock: args.toBlock }),
      robinhoodPublicClient.getLogs({ event: transferEvent, args: { to: batch }, fromBlock: args.fromBlock, toBlock: args.toBlock }),
    ]);
    transferLogs.push(...outgoing, ...incoming);
  }
  const launchLogs: any[] = [];
  for (const batch of chunks(args.wallets, ADDRESS_BATCH_SIZE)) {
    const [v1LaunchLogs, v2LaunchLogs] = await Promise.all([
      robinhoodPublicClient.getLogs({
        address: getAddress(PONS_CONTRACTS.factory), event: tokenLaunchedEvent,
        args: { deployer: batch }, fromBlock: args.fromBlock, toBlock: args.toBlock,
      }),
      robinhoodPublicClient.getLogs({
        address: getAddress(PONS_V2_LIVE_EMITTER), event: tokenLaunchedV2Event,
        args: { deployer: batch }, fromBlock: args.fromBlock, toBlock: args.toBlock,
      }),
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
    const transfers: RobinhoodTransferEvidence[] = [];
    for (const log of transferLogs.filter(item => item.transactionHash === hash)) {
      if (!log.args.from || !log.args.to || log.args.value == null) continue;
      transfers.push({ token: getAddress(log.address), from: getAddress(log.args.from), to: getAddress(log.args.to), value: log.args.value });
    }
    const block = await robinhoodPublicClient.getBlock({ blockNumber: receipt.blockNumber });
    for (const wallet of args.wallets) {
      const launchedTokens = launchLogs
        .filter(log => log.transactionHash === hash && log.args.deployer && sameAddress(log.args.deployer, wallet))
        .flatMap(log => log.args.token ? [getAddress(log.args.token)] : []);
      const classification = classifyRobinhoodWalletTransaction(wallet, {
        hash, from: getAddress(transaction.from), value: transaction.value,
        transfers, launchedTokens,
      });
      if (!classification) continue;
      const metadata = await tokenMetadata(classification.token).catch(() => null);
      events.push({
        kind: classification.kind,
        chain: 'robinhood',
        wallet,
        signature: hash,
        timestamp: Number(block.timestamp),
        blockNumber: Number(receipt.blockNumber),
        tokenMint: classification.token,
        tokenAmount: normalizedAmount(classification.amountRaw, metadata?.decimals ?? null),
        tokenSymbol: metadata?.symbol ?? null,
        tokenName: metadata?.name ?? null,
        type: classification.evidence,
        ...(classification.kind === 'buy' || classification.kind === 'sell' ? { amountSol: null } : {}),
      } as WalletWatchEvent);
    }
  }
  return events;
}

async function initializeMissingCursors(wallets: Address[], latest: bigint): Promise<Map<string, bigint>> {
  const { data, error } = await supabase
    .from('wallet_monitor_cursors')
    .select('wallet_address,last_processed_block')
    .eq('chain', 'robinhood')
    .in('wallet_address', wallets);
  if (error) throw error;
  const cursors = new Map((data ?? []).map(row => [String(row.wallet_address).toLowerCase(), BigInt(row.last_processed_block)]));
  const missing = wallets.filter(wallet => !cursors.has(wallet.toLowerCase()));
  if (missing.length) {
    const { error: insertError } = await supabase.from('wallet_monitor_cursors').upsert(
      missing.map(wallet => ({ chain: 'robinhood', wallet_address: wallet, last_processed_block: latest.toString() })),
      { onConflict: 'chain,wallet_address' },
    );
    if (insertError) throw insertError;
  }
  return cursors;
}

export async function pollRobinhoodTrackedWallets(): Promise<{
  events: WalletWatchEvent[];
  checkpointBlock: bigint | null;
  wallets: Address[];
}> {
  const allWallets = (await getTrackedWalletAddressesForChain('robinhood')).map(value => getAddress(value));
  if (!allWallets.length) return { events: [], checkpointBlock: null, wallets: [] };
  const wallets = (await getActiveTrackedWalletAddresses('robinhood')).map(value => getAddress(value));
  const latest = await robinhoodPublicClient.getBlockNumber();
  const cursors = await initializeMissingCursors(allWallets, latest);
  const activeKeys = new Set(wallets.map(wallet => wallet.toLowerCase()));
  const pausedWallets = allWallets.filter(wallet => !activeKeys.has(wallet.toLowerCase()));
  if (pausedWallets.length) await commitRobinhoodWalletCheckpoints(pausedWallets, latest);
  const existingWallets = wallets.filter(wallet => cursors.has(wallet.toLowerCase()));
  if (!existingWallets.length) return { events: [], checkpointBlock: null, wallets: [] };
  const earliest = existingWallets.reduce((minimum, wallet) => {
    const cursor = cursors.get(wallet.toLowerCase())!;
    return cursor < minimum ? cursor : minimum;
  }, latest);
  const fromBlock = earliest + 1n;
  const toBlock = fromBlock + MAX_BLOCKS_PER_CYCLE - 1n < latest
    ? fromBlock + MAX_BLOCKS_PER_CYCLE - 1n
    : latest;
  const checkpointWallets = walletsEligibleForCheckpoint(existingWallets, cursors, toBlock);
  const events = (await scanRobinhoodWalletActivity({ wallets: checkpointWallets, fromBlock, toBlock }))
    .filter(event => eventIsAfterWalletCursor(event, cursors));
  return { events, checkpointBlock: toBlock, wallets: checkpointWallets };
}

export function eventIsAfterWalletCursor(event: WalletWatchEvent, cursors: Map<string, bigint>): boolean {
  const cursor = cursors.get(event.wallet.toLowerCase());
  return cursor != null && BigInt(event.blockNumber ?? 0) > cursor;
}

export function walletsEligibleForCheckpoint(
  wallets: Address[], cursors: Map<string, bigint>, block: bigint,
): Address[] {
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
