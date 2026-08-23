import 'dotenv/config';

import { getAddress } from 'viem';

import { robinhoodPublicClient } from '../src/chains/robinhood/rpc.js';
import { scanRobinhoodWalletActivity } from '../src/chains/robinhood/robinhoodWalletWatcher.js';
import { detectWalletAddress } from '../src/services/walletAddress.js';

const input = process.argv[2];
const detected = detectWalletAddress(input ?? '');
if (!detected.valid || detected.family !== 'evm' || !detected.normalizedAddress) {
  console.error('Usage: npx tsx scripts/inspectRobinhoodWallet.ts <public-evm-wallet-address>');
  process.exitCode = 1;
} else {
  const latest = await robinhoodPublicClient.getBlockNumber();
  const lookback = BigInt(Math.max(1, Math.min(2_000, Number(process.argv[3] ?? 500))));
  const fromBlock = latest > lookback ? latest - lookback : 0n;
  const events = await scanRobinhoodWalletActivity({
    wallets: [getAddress(detected.normalizedAddress)], fromBlock, toBlock: latest,
  });
  console.log(JSON.stringify({
    wallet: detected.normalizedAddress,
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
