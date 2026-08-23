import 'dotenv/config';

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getAddress } from 'viem';

import {
  classifyRobinhoodWalletTransaction,
  eventIsAfterWalletCursor,
  walletsEligibleForCheckpoint,
} from '../src/chains/robinhood/robinhoodWalletWatcher.js';
import { PONS_CONTRACTS } from '../src/chains/robinhood/ponsContracts.js';
import type { WalletWatchEvent } from '../src/core/walletWatcher.js';
import {
  buildWalletActivityButtons,
  buildWalletActivityMessage,
} from '../src/services/walletActivityDeliveryService.js';
import { walletFamilyHasLiveMonitoring } from '../src/services/walletAddress.js';
import { resolveTrackedWalletChain } from '../src/services/trackedWalletService.js';

const wallet = getAddress('0xf435ac1926e21d47bfe0916bd1f15c22ca6ceb4b');
const token = getAddress('0x26de761468a48b2f939d60755fe5413ee4a9c03e');
const other = getAddress('0x1111111111111111111111111111111111111111');
const hash = `0x${'a'.repeat(64)}` as const;

function verifiedPreIndexFdv() {
  return {
    tokenAddress: token, valueUsd: 4_577.85, valuationType: 'FDV',
    source: 'PONS_V2_CURVE_RESERVE_SPOT', tokenPriceSource: 'PONS_V2_CURVE_RESERVE_RATIO',
    quoteAsset: PONS_CONTRACTS.weth, quoteUsdSource: 'DEXSCREENER_ROBINHOOD_BASE_TOKEN_PRICE',
    observedAt: new Date().toISOString(), indexed: false,
  };
}

function tx(transfers: Array<{ token: string; from: string; to: string; value: bigint }>, value = 0n) {
  return {
    hash, from: wallet, value,
    transfers: transfers.map(item => ({ ...item, token: getAddress(item.token), from: getAddress(item.from), to: getAddress(item.to) })),
  };
}

test('Robinhood trade classification requires corroborating quote/native transaction evidence', () => {
  const buy = classifyRobinhoodWalletTransaction(wallet, tx([
    { token: PONS_CONTRACTS.weth, from: wallet, to: other, value: 2n },
    { token, from: other, to: wallet, value: 100n },
  ]));
  assert.equal(buy?.kind, 'buy');

  const nativeBuy = classifyRobinhoodWalletTransaction(wallet, tx([
    { token, from: other, to: wallet, value: 100n },
  ], 2n));
  assert.equal(nativeBuy?.kind, 'buy');

  const sell = classifyRobinhoodWalletTransaction(wallet, tx([
    { token, from: wallet, to: other, value: 100n },
    { token: PONS_CONTRACTS.weth, from: other, to: wallet, value: 2n },
  ]));
  assert.equal(sell?.kind, 'sell');
});

test('simple inbound and outbound transfers remain neutral', () => {
  assert.equal(classifyRobinhoodWalletTransaction(wallet, tx([
    { token, from: other, to: wallet, value: 100n },
  ]))?.kind, 'receive');
  assert.equal(classifyRobinhoodWalletTransaction(wallet, tx([
    { token, from: wallet, to: other, value: 100n },
  ]))?.kind, 'send');
});

test('PONS launch classification requires the decoded factory event', () => {
  assert.equal(classifyRobinhoodWalletTransaction(wallet, {
    ...tx([]), launchedTokens: [token],
  })?.kind, 'launch');
  assert.equal(classifyRobinhoodWalletTransaction(wallet, tx([])), null);
});

test('restart cursor filters historical replay and never regresses newer wallets', () => {
  const event = { wallet, blockNumber: 101 } as WalletWatchEvent;
  const cursors = new Map([[wallet.toLowerCase(), 100n], [other.toLowerCase(), 150n]]);
  assert.equal(eventIsAfterWalletCursor(event, cursors), true);
  assert.equal(eventIsAfterWalletCursor({ ...event, blockNumber: 100 } as WalletWatchEvent, cursors), false);
  assert.deepEqual(walletsEligibleForCheckpoint([wallet, other], cursors, 120n), [wallet]);
});

test('Robinhood wallet alert preserves verified market/FDV context and safe actions', () => {
  const event: WalletWatchEvent = {
    kind: 'buy', chain: 'robinhood', wallet, signature: hash, tokenMint: token,
    tokenAmount: 123.45, tokenSymbol: '<SPURDO>', tokenName: 'Spurdo & Co',
    amountSol: null, type: 'verified quote flow', marketCap: 25_500, fdv: 40_000,
    liquidity: 23_000, volume5m: 6_800, devHoldingPercent: 0,
    devHoldingEvidence: 'VERIFIED', burnedPercent: 0, burnEvidence: 'VERIFIED',
  };
  const message = buildWalletActivityMessage({ event, label: '<My Wallet>' });
  assert.match(message, /&lt;SPURDO&gt;/);
  assert.match(message, /Market cap\s+<b>\$25\.5K<\/b>/);
  assert.match(message, /Liquidity\s+<b>\$23\.0K<\/b>/);
  assert.match(message, /Dev holding\s+<b>0%<\/b>/);
  assert.match(message, /Burned\s+<b>0%<\/b>/);
  assert.doesNotMatch(message, /\$40\.0K|Trade/);

  const actions = buildWalletActivityButtons(event, {
    chartUrl: 'https://dexscreener.com/robinhood/0xpair',
    tokenUrl: `https://robinhoodchain.blockscout.com/token/${token}`,
    chartSource: 'dexscreener', tokenSource: 'blockscout',
  });
  assert.deepEqual(actions.map(row => row.map(action => action.text)), [
    ['📊 Chart', '🔎 Token'], ['📋 Copy CA'], ['🐋 Wallet Activity'],
  ]);
  assert.equal(actions[1][0].callback_data, `COPY_CA_${token}`);
  assert.equal(actions.flat().some(action => action.text.includes('Trade')), false);
  for (const action of actions.flat()) if (action.callback_data) {
    assert.ok(Buffer.byteLength(action.callback_data, 'utf8') <= 64);
  }
});

test('pre-index wallet activity uses verified FDV and never fabricates Chart', () => {
  const event = {
    kind: 'receive', chain: 'robinhood', wallet, signature: hash, tokenMint: token,
    tokenAmount: 5, tokenSymbol: 'SPURDO', type: 'Inbound ERC-20 transfer only',
    fdv: 4_577.85,
    preIndexValuation: verifiedPreIndexFdv(),
  } as WalletWatchEvent;
  const message = buildWalletActivityMessage({ event, label: 'Watch <One>' });
  assert.match(message, /FDV\s+<b>\$4\.58K<\/b>/);
  assert.doesNotMatch(message, /Market cap|Liquidity/);
  const actions = buildWalletActivityButtons(event, {
    tokenUrl: `https://robinhoodchain.blockscout.com/token/${token}`, tokenSource: 'blockscout',
  });
  assert.deepEqual(actions[0].map(action => action.text), ['🔎 Token']);
});

test('network model, selection UX, watcher isolation and durable per-network cursor are explicit', async () => {
  assert.equal(walletFamilyHasLiveMonitoring('robinhood'), true);
  assert.equal(walletFamilyHasLiveMonitoring('evm'), false);
  assert.equal(resolveTrackedWalletChain('evm', 'robinhood'), 'robinhood');
  assert.equal(resolveTrackedWalletChain('evm'), 'evm');
  assert.equal(resolveTrackedWalletChain('solana'), 'solana');
  const ui = await readFile(new URL('../src/bot/walletTracking.ts', import.meta.url), 'utf8');
  assert.match(ui, /WALLET_NETWORK_ROBINHOOD/);
  assert.match(ui, /Ethereum — Coming later/);
  const watcher = await readFile(new URL('../src/chains/robinhood/robinhoodWalletWatcher.ts', import.meta.url), 'utf8');
  assert.match(watcher, /getActiveTrackedWalletAddresses\('robinhood'\)/);
  const solanaWatcher = await readFile(new URL('../src/core/walletWatcher.ts', import.meta.url), 'utf8');
  assert.match(solanaWatcher, /getActiveTrackedWalletAddresses\(\s*'solana'/);
  const migration = await readFile(new URL('../supabase/migrations/20260823220000_robinhood_wallet_monitor_cursors.sql', import.meta.url), 'utf8');
  assert.match(migration, /primary key \(chain, wallet_address\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /'RECEIVE', 'SEND'/);
});

test('subscriber and delivery keys remain per-user while paused/removed rows are excluded', async () => {
  const store = await readFile(new URL('../src/services/trackedWalletService.ts', import.meta.url), 'utf8');
  assert.match(store, /\.eq\(\s*'is_active',\s*true/);
  assert.match(store, /\.eq\(\s*'alerts_enabled',\s*true/);
  const migration = await readFile(new URL('../supabase/migrations/20260823133000_wallet_activity_deliveries.sql', import.meta.url), 'utf8');
  assert.match(migration, /unique\s*\(\s*telegram_id,\s*wallet_address,\s*transaction_signature/s);
  const watcher = await readFile(new URL('../src/chains/robinhood/robinhoodWalletWatcher.ts', import.meta.url), 'utf8');
  assert.match(watcher, /getTrackedWalletAddressesForChain\('robinhood'\)/);
  assert.match(watcher, /pausedWallets[\s\S]*commitRobinhoodWalletCheckpoints\(pausedWallets, latest\)/);
  assert.match(store, /if \(!remaining\?\.length\)[\s\S]*\.from\('wallet_monitor_cursors'\)[\s\S]*\.delete\(\)/);
});

test('one chain scan fans out through the existing per-user delivery ledger', async () => {
  const watcher = await readFile(new URL('../src/chains/robinhood/robinhoodWalletWatcher.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(watcher, /telegram_id/);
  const delivery = await readFile(new URL('../src/services/walletActivityDeliveryService.ts', import.meta.url), 'utf8');
  assert.match(delivery, /for \(\s*const subscriber\s*of subscribers/);
  assert.match(delivery, /telegramId:\s*subscriber\.telegram_id/);
  assert.match(delivery, /reserve_wallet_activity_delivery/);
});
