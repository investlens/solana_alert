import 'dotenv/config';

import { decodeEventLog, formatUnits, getAddress, parseAbiItem, type Address, type Hex } from 'viem';

import { robinhoodPublicClient } from '../src/chains/robinhood/rpc.js';
import {
  classifyRobinhoodWalletTransaction,
  scanRobinhoodWalletActivity,
  type RobinhoodTransferEvidence,
} from '../src/chains/robinhood/robinhoodWalletWatcher.js';
import { getRobinhoodTokenMetadata } from '../src/chains/robinhood/tokenMetadata.js';
import { detectWalletAddress } from '../src/services/walletAddress.js';

const transferEvent = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
);

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function requireWallet(input: string | null): Address {
  const detected = detectWalletAddress(input ?? '');
  if (!detected.valid || detected.family !== 'evm' || !detected.normalizedAddress) {
    throw new Error('A valid public EVM wallet is required');
  }
  return getAddress(detected.normalizedAddress);
}

async function inspectExactTransaction(hash: Hex, wallet: Address) {
  const [transaction, receipt] = await Promise.all([
    robinhoodPublicClient.getTransaction({ hash }),
    robinhoodPublicClient.getTransactionReceipt({ hash }),
  ]);
  const block = await robinhoodPublicClient.getBlock({ blockNumber: receipt.blockNumber });
  const transfers: RobinhoodTransferEvidence[] = [];
  for (const log of receipt.logs) {
    try {
      const receiptLog = log as typeof log & { topics: readonly Hex[] };
      const decoded = decodeEventLog({
        abi: [transferEvent],
        data: receiptLog.data,
        topics: [...receiptLog.topics] as [Hex, ...Hex[]],
      }) as { args: { from: Address; to: Address; value: bigint } };
      transfers.push({
        token: getAddress(receiptLog.address),
        from: getAddress(decoded.args.from),
        to: getAddress(decoded.args.to),
        value: decoded.args.value,
      });
    } catch {
      // The receipt contains non-ERC-20 events; they are not trade-direction evidence.
    }
  }
  const classification = classifyRobinhoodWalletTransaction(wallet, {
    hash,
    from: getAddress(transaction.from),
    value: transaction.value,
    transfers,
  });
  const relevant = transfers.filter(transfer =>
    transfer.from.toLowerCase() === wallet.toLowerCase() ||
    transfer.to.toLowerCase() === wallet.toLowerCase(),
  );
  const described = await Promise.all(relevant.map(async transfer => {
    const metadata = await getRobinhoodTokenMetadata(transfer.token).catch(() => null);
    return {
      token: transfer.token,
      symbol: metadata?.symbol ?? null,
      name: metadata?.name ?? null,
      direction: transfer.to.toLowerCase() === wallet.toLowerCase() ? 'IN' : 'OUT',
      from: transfer.from,
      to: transfer.to,
      rawAmount: transfer.value.toString(),
      amount: metadata?.decimals == null ? null : formatUnits(transfer.value, metadata.decimals),
    };
  }));
  console.log(JSON.stringify({
    network: 'robinhood',
    wallet,
    transaction: {
      hash,
      from: transaction.from,
      to: transaction.to,
      nativeValueWei: transaction.value.toString(),
      nativeValueEth: formatUnits(transaction.value, 18),
      block: receipt.blockNumber.toString(),
      timestamp: Number(block.timestamp),
      status: receipt.status,
    },
    relevantTransfers: described,
    classification: classification?.kind.toUpperCase() ?? 'NO_ACTIVITY',
    token: classification?.token ?? null,
    amountRaw: classification?.amountRaw?.toString() ?? null,
    evidence: classification?.evidence ?? null,
  }, null, 2));
}

async function inspectRecentWallet(wallet: Address) {
  const latest = await robinhoodPublicClient.getBlockNumber();
  const lookback = BigInt(Math.max(1, Math.min(2_000, Number(process.argv[3] ?? 500))));
  const fromBlock = latest > lookback ? latest - lookback : 0n;
  const events = await scanRobinhoodWalletActivity({
    wallets: [wallet], fromBlock, toBlock: latest,
  });
  console.log(JSON.stringify({
    wallet,
    network: 'robinhood',
    fromBlock: fromBlock.toString(),
    toBlock: latest.toString(),
    activities: events.map(event => ({
      block: event.blockNumber,
      transactionHash: event.signature,
      timestamp: event.timestamp,
      classification: event.kind.toUpperCase(),
      token: event.tokenMint,
      symbol: event.tokenSymbol ?? null,
      amount: 'tokenAmount' in event ? event.tokenAmount ?? null : null,
      evidence: event.type,
    })),
  }, null, 2));
}

try {
  const transactionHash = argument('--tx');
  if (transactionHash) {
    if (!/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) throw new Error('Invalid transaction hash');
    await inspectExactTransaction(transactionHash as Hex, requireWallet(argument('--wallet')));
  } else {
    await inspectRecentWallet(requireWallet(process.argv[2] ?? null));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(
    'Usage:\n' +
    '  npx tsx scripts/inspectRobinhoodWallet.ts <public-wallet> [lookback<=2000]\n' +
    '  npx tsx scripts/inspectRobinhoodWallet.ts --tx <transaction-hash> --wallet <public-wallet>',
  );
  process.exitCode = 1;
}
