import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  clearConversationState,
  getConversationState,
  resetConversationStatesForTests,
  setConversationState,
} from '../src/bot/conversationState.js';
import {
  assertValidCallbackData,
  callbackDataByteLength,
} from '../src/bot/callbackData.js';
import {
  escapeTelegramHtml,
  normalizeSolanaPublicAddress,
} from '../src/bot/walletInput.js';
import { deliverLegacyAlert } from '../src/core/legacyAlertDelivery.js';
import { opportunityDeliveryIdentity } from '../src/services/opportunityDeliveryIdentity.js';

test('watchlist persistence is separate from opportunity delivery state', async () => {
  const actions = await readFile(
    new URL('../src/bot/opportunityActions.ts', import.meta.url),
    'utf8',
  );
  const watchlist = await readFile(
    new URL('../src/services/opportunityWatchlistService.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(actions, /\.from\(['"]opportunity_deliveries['"]\)/);
  assert.doesNotMatch(watchlist, /opportunity_deliveries/);
  assert.match(watchlist, /user_opportunity_watchlist/);
});

test('track state cannot consume BUY delivery identity', () => {
  const watchlist = new Set(['user:42:opportunity:7']);
  const deliveries = new Set<string>();
  const buy = opportunityDeliveryIdentity({ action: 'BUY', status: 'NEW' });

  assert.equal(watchlist.size, 1);
  assert.equal(deliveries.has(buy), false);
});

test('repeated BUY dedups while later EXIT remains eligible', () => {
  const delivered = new Set<string>();
  const buy = opportunityDeliveryIdentity({ action: 'BUY', status: 'NEW' });
  const repeatedBuy = opportunityDeliveryIdentity({ action: 'buy', status: 'new' });
  const exit = opportunityDeliveryIdentity({ action: 'EXIT', status: 'NEW' });

  assert.equal(delivered.has(buy), false);
  delivered.add(buy);
  assert.equal(delivered.has(repeatedBuy), true);
  assert.equal(delivered.has(exit), false);
});

test('failed Telegram send is neither persisted nor charged', async () => {
  let persisted = 0;
  let charged = 0;
  const delivered = await deliverLegacyAlert({
    send: async () => false,
    persist: async () => { persisted += 1; },
    consumeFreeTrial: async () => { charged += 1; },
  });

  assert.equal(delivered, false);
  assert.equal(persisted, 0);
  assert.equal(charged, 0);
});

test('successful Free send persists and consumes trial exactly once', async () => {
  let persisted = 0;
  let charged = 0;
  const delivered = await deliverLegacyAlert({
    send: async () => true,
    persist: async () => { persisted += 1; },
    consumeFreeTrial: async () => { charged += 1; },
  });

  assert.equal(delivered, true);
  assert.equal(persisted, 1);
  assert.equal(charged, 1);
});

test('invalid wallet address is rejected', () => {
  assert.throws(() => normalizeSolanaPublicAddress('not-a-solana-wallet'));
  assert.equal(
    normalizeSolanaPublicAddress('11111111111111111111111111111111'),
    '11111111111111111111111111111111',
  );
});

test('HTML-sensitive wallet label is escaped', () => {
  assert.equal(
    escapeTelegramHtml('A&B <Whale> "One"'),
    'A&amp;B &lt;Whale&gt; &quot;One&quot;',
  );
});

test('wallet and payment flows have one exclusive owner', () => {
  resetConversationStatesForTests();
  setConversationState('42', 'ADD_WALLET');
  assert.equal(getConversationState('42'), 'ADD_WALLET');

  setConversationState('42', 'SUBMIT_PAYMENT_HASH');
  assert.equal(getConversationState('42'), 'SUBMIT_PAYMENT_HASH');

  clearConversationState('42');
  assert.equal(getConversationState('42'), 'NONE');
});

test('Wallet Add Back route clears pending input state', async () => {
  const walletTracking = await readFile(
    new URL('../src/bot/walletTracking.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    walletTracking,
    /'WALLET_TRACKING'[\s\S]{0,260}clearConversationState\(telegramId\)/,
  );
});

test('generated Phase 1 callback payloads fit Telegram limit', () => {
  const callbacks = [
    'OPP_TRACK_9223372036854775807',
    'OPP_UNTRACK_9223372036854775807',
    'OPP_VIEW_9223372036854775807',
    'WALLET_TOGGLE_9223372036854775807',
    'WALLET_ACTIVITY_9223372036854775807',
    'WALLET_REMOVE_CONFIRM_9223372036854775807',
    'UPGRADE_CANCEL',
  ];

  for (const callback of callbacks) {
    assert.equal(assertValidCallbackData(callback), callback);
    assert.ok(callbackDataByteLength(callback) <= 64);
  }
  assert.throws(() => assertValidCallbackData(`X${'a'.repeat(64)}`));
});
