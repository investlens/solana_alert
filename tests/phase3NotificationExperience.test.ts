import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertAlphaActions,
  burnEvidenceMetric,
  renderAlphaNotification,
  type AlphaNotification,
} from '../src/ui/alphaNotification.js';
import { buildCreatorNotification, buildExecutionNotification } from '../src/ui/alphaNotificationPresets.js';
import { buildWalletActivityMessage } from '../src/services/walletActivityDeliveryService.js';
import { deliverReservedTelegram } from '../src/services/telegramDeliveryContract.js';

function render(state: AlphaNotification['state'], extra: Partial<AlphaNotification> = {}) {
  return renderAlphaNotification({
    category: 'opportunity', severity: 'watch', state,
    symbol: 'A&B <TOKEN>', address: '11111111111111111111111111111111',
    confidence: 88, risk: 'REVIEW', reason: 'Evidence changed.', ...extra,
  });
}

test('representative Opportunity Entry, Building, and Risk snapshots', () => {
  assert.match(render('ENTRY_READY'), /ALPHAOS · 🔥 ENTRY READY/);
  assert.match(render('BUILDING'), /ALPHAOS · 📈 BUILDING/);
  assert.match(render('EXIT_AVOID', { category: 'risk', severity: 'critical' }), /ALPHAOS · 🔴 EXIT \/ AVOID/);
});

test('representative Wallet Buy, Sell, and Launch snapshots', () => {
  const common = { wallet: '7KsN4<&>111111111111111111111', tokenMint: 'TokenMint11111111111111111111111111111', signature: 'sig', type: 'SWAP' };
  const buy = buildWalletActivityMessage({ event: { ...common, kind: 'buy', amountSol: 3.2 }, label: 'A&B <Whale>' });
  const sell = buildWalletActivityMessage({ event: { ...common, kind: 'sell', amountSol: 1.1 }, label: null });
  const launch = buildWalletActivityMessage({ event: { ...common, kind: 'launch' }, label: null });
  assert.match(buy, /ALPHAOS · 🐋 WALLET BUY/);
  assert.match(buy, /3\.20 SOL/);
  assert.match(sell, /ALPHAOS · 🔴 WALLET EXIT/);
  assert.match(launch, /ALPHAOS · 🚀 WALLET LAUNCH/);
  assert.match(buy, /A&amp;B &lt;WHALE&gt;/);
});

test('Creator positive and developer risk snapshots', () => {
  const positive = buildCreatorNotification({ symbol: 'GOOD', address: '0x123', reputation: 'Trusted', reason: 'Creator history improved.' });
  const risk = buildCreatorNotification({ symbol: 'RISK', address: '0x456', risk: true, transferredAmount: 2, reason: 'Developer moved tokens.' });
  assert.match(positive, /CREATOR EVENT/);
  assert.match(positive, /Reputation/);
  assert.match(risk, /ALPHAOS · ⚠️ RISK/);
  assert.match(risk, /Protect capital/);
});

test('burn evidence distinguishes confirmed zero from unavailable', () => {
  assert.deepEqual(burnEvidenceMetric(0), { label: 'Burn', value: '0 confirmed' });
  assert.deepEqual(burnEvidenceMetric(null), { label: 'Burn', value: 'Data unavailable' });
  assert.match(buildCreatorNotification({ symbol: 'BURN', address: 'x', burnObserved: true, burnedAmount: 0, reason: 'Checked.' }), /0 confirmed/);
  assert.match(buildCreatorNotification({ symbol: 'BURN', address: 'x', burnObserved: true, burnedAmount: null, reason: 'Checked.' }), /Data unavailable/);
});

test('execution snapshots cover success, failure, pause and resume', () => {
  assert.match(buildExecutionNotification({ state: 'EXECUTED', symbol: 'ABC' }), /✅ EXECUTED/);
  assert.match(buildExecutionNotification({ state: 'FAILED', symbol: 'ABC', reason: '<failure>' }), /EXECUTION FAILED/);
  assert.match(buildExecutionNotification({ state: 'FAILED', symbol: 'ABC', reason: '<failure>' }), /&lt;failure&gt;/);
  assert.match(buildExecutionNotification({ state: 'PAUSED' }), /AUTO TRADE PAUSED/);
  assert.match(buildExecutionNotification({ state: 'RESUMED' }), /AUTO TRADE RESUMED/);
});

test('Free, Pro, and Admin presentation remains one visual grammar', () => {
  const free = render('WATCHING', { access: 'FREE' });
  const pro = render('WATCHING', { access: 'PRO' });
  const admin = render('WATCHING', { access: 'ADMIN' });
  assert.match(free, /Free intelligence may be delayed/);
  assert.doesNotMatch(pro, /Free intelligence may be delayed/);
  assert.doesNotMatch(admin, /Free intelligence may be delayed/);
  for (const message of [free, pro, admin]) assert.match(message, /^<b>ALPHAOS ·/);
});

test('shared renderer escapes every text-bearing field', () => {
  const message = render('WATCHING', {
    subtitle: '<subtitle>', risk: '<risk>', metrics: [{ label: '<label>', value: '<value>' }],
    evidence: ['<evidence>'], recommendedAction: '<action>',
  });
  assert.doesNotMatch(message, /<TOKEN>|<subtitle>|<risk>|<label>|<value>|<evidence>|<action>/);
  assert.match(message, /A&amp;B &lt;TOKEN&gt;/);
});

test('callback contract enforces Telegram 64-byte limit', () => {
  assert.doesNotThrow(() => assertAlphaActions([[{ text: 'Track', callback_data: `OPP_TRACK_${'9'.repeat(19)}` }]]));
  assert.throws(() => assertAlphaActions([[{ text: 'Too long', callback_data: 'x'.repeat(65) }]]));
});

test('wallet activity has one user-facing broadcaster', async () => {
  const watcher = await readFile(new URL('../src/core/walletWatcher.ts', import.meta.url), 'utf8');
  const delivery = await readFile(new URL('../src/services/walletActivityDeliveryService.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(watcher, /sendTelegram\(/);
  assert.equal((delivery.match(/(?:await |=> )sendTelegram\(/g) ?? []).length, 1);
});

test('PONS lifecycle has one user-facing opportunity broadcaster and no Solana execution action', async () => {
  const legacy = await readFile(new URL('../src/chains/robinhood/ponsAlphaTelegram.ts', import.meta.url), 'utf8');
  const delivery = await readFile(new URL('../src/services/opportunityDeliveryService.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(legacy, /sendTelegram\(/);
  assert.match(legacy, /Legacy direct broadcast suppressed/);
  assert.match(delivery, /executionAvailable[\s\S]*\.toLowerCase\(\) ===[\s\S]*'solana'/);
});

test('delivery invariants retain mute, admin-first release, lifecycle identity and retry release', async () => {
  const delivery = await readFile(new URL('../src/services/opportunityDeliveryService.ts', import.meta.url), 'utf8');
  const identity = await readFile(new URL('../src/services/opportunityDeliveryIdentity.ts', import.meta.url), 'utf8');
  const watchlist = await readFile(new URL('../src/services/opportunityWatchlistService.ts', import.meta.url), 'utf8');
  assert.match(delivery, /isStrategyEnabledForUser/);
  assert.match(delivery, /paidReleaseAt[\s\S]*10_000/);
  assert.match(delivery, /releaseDelivery\(/);
  assert.match(identity, /action/);
  assert.doesNotMatch(watchlist, /opportunity_deliveries/);
});

test('shared delivery contract releases failed sends but never duplicates accepted sends', async () => {
  let released = 0;
  let completed = 0;
  const failed = await deliverReservedTelegram({
    send: async () => { throw new Error('Telegram unavailable'); },
    complete: async () => { completed += 1; },
    release: async () => { released += 1; },
  });
  assert.deepEqual({ sent: failed.sent, recorded: failed.recorded }, { sent: false, recorded: false });
  assert.equal(released, 1);
  assert.equal(completed, 0);

  const accountingFailure = await deliverReservedTelegram({
    send: async () => {},
    complete: async () => { throw new Error('ledger unavailable'); },
    release: async () => { released += 1; },
  });
  assert.deepEqual({ sent: accountingFailure.sent, recorded: accountingFailure.recorded }, { sent: true, recorded: false });
  assert.equal(released, 1);
});
