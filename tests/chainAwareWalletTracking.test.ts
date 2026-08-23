import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { clearConversationState, getConversationState, setConversationState } from '../src/bot/conversationState.js';
import { escapeTelegramHtml } from '../src/bot/walletInput.js';
import { detectWalletAddress, walletCoverageText, walletFamilyHasLiveMonitoring } from '../src/services/walletAddress.js';

const solana = '11111111111111111111111111111111';
const evm = '0xf435ac1926e21d47bfe0916bd1f15c22ca6ceb4b';

test('detects valid Solana public addresses and rejects invalid Solana input', () => {
  const valid = detectWalletAddress(solana);
  assert.equal(valid.valid, true);
  assert.equal(valid.family, 'solana');
  assert.equal(valid.normalizedAddress, solana);
  assert.equal(valid.liveMonitoringAvailable, true);
  assert.equal(detectWalletAddress('not-a-solana-wallet').valid, false);
});

test('detects and normalizes valid EVM addresses without assigning a network', () => {
  const valid = detectWalletAddress(evm);
  assert.equal(valid.valid, true);
  assert.equal(valid.family, 'evm');
  assert.match(valid.normalizedAddress ?? '', /^0x[0-9A-Fa-f]{40}$/);
  assert.equal(valid.network, null);
  assert.equal(valid.liveMonitoringAvailable, false);
});

test('rejects malformed EVM, private-key-like and seed-phrase input', () => {
  assert.equal(detectWalletAddress('0x1234').valid, false);
  assert.equal(detectWalletAddress(`0x${'a'.repeat(64)}`).valid, false);
  assert.equal(detectWalletAddress('alpha beta gamma delta').valid, false);
});

test('monitoring capability and wallet coverage are family aware', () => {
  assert.equal(walletFamilyHasLiveMonitoring('solana'), true);
  assert.equal(walletFamilyHasLiveMonitoring('evm'), false);
  assert.equal(walletCoverageText('solana', true), 'Live tracking · ON');
  assert.equal(walletCoverageText('solana', false), 'Live tracking · PAUSED');
  assert.equal(walletCoverageText('evm', false), 'Saved wallet · Monitoring unavailable');
});

test('Solana watcher query cannot consume EVM rows', async () => {
  const watcher = await readFile(new URL('../src/core/walletWatcher.ts', import.meta.url), 'utf8');
  assert.match(watcher, /getActiveTrackedWalletAddresses\(\s*'solana'/);
  const store = await readFile(new URL('../src/services/trackedWalletService.ts', import.meta.url), 'utf8');
  assert.match(store, /\.eq\(\s*'chain',\s*chain/);
  assert.match(store, /liveMonitoring[\s\S]*is_active:[\s\S]*liveMonitoring/);
});

test('wallet UI hides toggle and activity controls for unsupported families', async () => {
  const source = await readFile(new URL('../src/bot/walletTracking.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(walletFamilyHasLiveMonitoring\(wallet\.chain\)\)[\s\S]*WALLET_TOGGLE_/);
  assert.match(source, /if \(wallets\.some\(wallet => walletFamilyHasLiveMonitoring\(wallet\.chain\)\)\)/);
  assert.match(source, /Live monitoring is not available for this wallet type yet/);
});

test('/trackwallet and conversational add use the shared detector', async () => {
  const source = await readFile(new URL('../src/bot/walletTracking.ts', import.meta.url), 'utf8');
  assert.ok((source.match(/detectWalletAddress\(/g) ?? []).length >= 2);
  assert.doesNotMatch(source, /new PublicKey/);
});

test('wallet labels remain HTML escaped and Add Wallet cancel clears state', () => {
  assert.equal(escapeTelegramHtml('<Whale & Co>'), '&lt;Whale &amp; Co&gt;');
  setConversationState('chain-wallet-user', 'ADD_WALLET');
  clearConversationState('chain-wallet-user');
  assert.equal(getConversationState('chain-wallet-user'), 'NONE');
});

test('existing wallet persistence remains deduplicated by user, family and address', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20260823131500_user_tracked_wallets.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /unique\s*\(\s*telegram_id,\s*chain,\s*wallet_address\s*\)/s);
  const store = await readFile(new URL('../src/services/trackedWalletService.ts', import.meta.url), 'utf8');
  assert.match(store, /onConflict:\s*'telegram_id,chain,wallet_address'/);
});
