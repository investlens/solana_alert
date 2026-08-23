import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import { ACTIVE_TELEGRAM_ALERT_INVENTORY, DOCUMENTED_ACTIVE_TELEGRAM_SEND_SOURCES, normalTelegramAlertsOutsideSharedContract } from '../src/services/telegramAlertInventory.js';
import { buildAlphaMarketActions } from '../src/ui/alphaNotificationActions.js';
import { buildCreatorNotification, buildExecutionNotification } from '../src/ui/alphaNotificationPresets.js';
import { renderAlphaNotification } from '../src/ui/alphaNotification.js';

const ponsAddress = '0x02b12345678901234567890123456789000915Fc';

function normalAlert(state: 'WATCHING' | 'ENTRY_READY' | 'EXIT_AVOID') {
  return renderAlphaNotification({
    category: state === 'EXIT_AVOID' ? 'risk' : 'market',
    severity: state === 'EXIT_AVOID' ? 'critical' : state === 'ENTRY_READY' ? 'positive' : 'watch',
    state,
    symbol: 'buzzland',
    subtitle: 'erling buzzland',
    address: ponsAddress,
    age: '3m',
    confidence: 88,
    risk: state === 'EXIT_AVOID' ? 'HIGH' : 'LOW',
    metrics: [
      { label: 'Market cap', value: '$25.50K' },
      { label: 'Liquidity', value: '$23.07K' },
      { label: '5m volume', value: '$6.83K' },
      { label: 'Momentum', value: '+5.29%' },
      { label: 'Exit impact', value: '0.13%' },
    ],
    reason: state === 'WATCHING' ? 'Early market quality passed initial checks.' : state === 'ENTRY_READY' ? 'Momentum reached confirmed entry conditions.' : 'Momentum weakened beyond the active thesis.',
    recommendedAction: state === 'WATCHING' ? 'Waiting for entry confirmation.' : state === 'ENTRY_READY' ? 'Verify live conditions before acting.' : 'Protect capital · review now.',
  });
}

test('PONS watching, entry and exit snapshots follow one commercial contract', () => {
  for (const state of ['WATCHING', 'ENTRY_READY', 'EXIT_AVOID'] as const) {
    const message = normalAlert(state);
    assert.match(message, /^<b>ALPHAOS · /);
    assert.match(message, /<b>BUZZLAND<\/b> · <code>0x02b1…915Fc<\/code>/);
    assert.ok(message.indexOf('Age') < message.indexOf('Market cap'));
    assert.ok(message.indexOf('Market cap') < message.indexOf('Liquidity'));
    assert.ok(message.indexOf('Liquidity') < message.indexOf('5m volume'));
    assert.ok(message.indexOf('Confidence') < message.indexOf('Risk'));
    assert.doesNotMatch(message, /Direct execution is unavailable|Copy Contract/);
  }
});

test('Robinhood early watch and boost sources use shared renderer and action preset', async () => {
  for (const path of ['../src/chains/robinhood/robinhoodObserver.ts', '../src/chains/robinhood/robinhoodBoostObserver.ts']) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /renderAlphaNotification/);
    assert.match(source, /buildAlphaMarketActions/);
    assert.doesNotMatch(source, /📋 Copy Contract|Direct execution is unavailable/);
  }
});

test('Solana opportunity and wallet action snapshots use the final grammar', () => {
  const opportunity = buildAlphaMarketActions({
    tradeUrl: 'https://jup.ag/swap/SOL-mint', chartUrl: 'https://dexscreener.com/solana/mint',
    tokenUrl: 'https://solscan.io/token/mint', trackCallback: 'OPP_TRACK_1', muteCallback: 'STRAT_TOGGLE_SOL_MOMENTUM',
  });
  assert.deepEqual(opportunity.map(row => row.map(item => item.text)), [
    ['⚡ Trade'], ['📊 Chart', '🔎 Token'], ['👀 Track', '🔕 Mute'],
  ]);
  const wallet = buildAlphaMarketActions({
    chartUrl: 'https://dexscreener.com/solana/mint', tokenUrl: 'https://solscan.io/token/mint',
    walletActivityCallback: 'WALLET_TRACKING',
  });
  assert.deepEqual(wallet.map(row => row.map(item => item.text)), [
    ['📊 Chart', '🔎 Token'], ['🐋 Wallet Activity'],
  ]);
});

test('creator and execution snapshots retain the shared visual grammar and escaping', () => {
  const creator = buildCreatorNotification({ symbol: '<dev>', address: ponsAddress, risk: true, transferredAmount: 2, reason: 'Developer <moved> tokens.' });
  const execution = buildExecutionNotification({ state: 'EXECUTED', symbol: '<abc>', address: 'mint', reason: 'Order filled.' });
  assert.match(creator, /ALPHAOS · ⚠️ RISK/);
  assert.match(creator, /&lt;DEV&gt;/);
  assert.match(execution, /ALPHAOS · ✅ EXECUTED/);
  assert.match(execution, /&lt;ABC&gt;/);
});

test('active alert inventory has no undocumented normal renderer bypass', () => {
  assert.equal(normalTelegramAlertsOutsideSharedContract().length, 0);
  assert.ok(ACTIVE_TELEGRAM_ALERT_INVENTORY.some(entry => entry.producer.includes('robinhoodObserver')));
  for (const entry of ACTIVE_TELEGRAM_ALERT_INVENTORY.filter(item => item.classification === 'specialized')) {
    assert.ok(entry.reason);
  }
});

test('every active direct Telegram send source is included in the inventory', async () => {
  const srcRoot = new URL('../src/', import.meta.url);
  const files = (await readdir(srcRoot, { recursive: true }))
    .filter(path => path.endsWith('.ts') && !path.endsWith('.backup.ts'));
  const active: string[] = [];
  for (const path of files) {
    if (path === 'services/telegram.ts') continue;
    const source = await readFile(new URL(path, srcRoot), 'utf8');
    if (/\b(?:safeSendTelegram|sendTelegram|telegram\.sendMessage)\s*\(/.test(source)) active.push(path);
  }
  assert.deepEqual(active.sort(), [...DOCUMENTED_ACTIVE_TELEGRAM_SEND_SOURCES].sort());
});

test('normal PONS buttons have no Trade, use Chart and Token, and fit callback limits', () => {
  const actions = buildAlphaMarketActions({
    chartUrl: `https://dexscreener.com/robinhood/${ponsAddress}`,
    tokenUrl: `https://robinhoodchain.blockscout.com/token/${ponsAddress}`,
  });
  assert.deepEqual(actions.map(row => row.map(item => item.text)), [['📊 Chart', '🔎 Token']]);
  assert.equal(actions.flat().some(item => /Trade/.test(item.text)), false);
  for (const action of actions.flat()) {
    if (action.callback_data) assert.ok(Buffer.byteLength(action.callback_data, 'utf8') <= 64);
  }
});
