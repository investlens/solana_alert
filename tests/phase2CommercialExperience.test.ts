import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  accessProfileForTier,
  hasCapability,
} from '../src/product/capabilities.js';
import {
  intelligenceMenu,
  mainAlphaMenu,
  tradingMenu,
} from '../src/bot/menus.js';
import { callbackDataByteLength } from '../src/bot/callbackData.js';
import { strategyDisplay } from '../src/product/strategyPresentation.js';

type Button = { text?: string; callback_data?: string };

function buttons(markup: any): Button[] {
  return (markup.reply_markup.inline_keyboard as Button[][]).flat();
}

test('commercial capability matrix prevents forged tier escalation', () => {
  const free = accessProfileForTier('free');
  const pro = accessProfileForTier('pro');
  const admin = accessProfileForTier('admin');

  const testerCapabilities = [
    'opportunities.view', 'opportunities.realtime', 'watchlist.use',
    'intelligence.investigations', 'intelligence.smartMoney', 'intelligence.creators', 'intelligence.performance',
    'wallets.track', 'wallets.activity', 'trading.external', 'strategies.manage', 'membership.manage',
  ] as const;
  for (const capability of testerCapabilities) {
    assert.equal(hasCapability(free, capability), true, `Free tester needs ${capability}`);
    assert.equal(hasCapability(pro, capability), true, `Pro tester needs ${capability}`);
    assert.equal(hasCapability(admin, capability), true, `Admin needs ${capability}`);
  }
  assert.equal(hasCapability(free, 'trading.admin'), false);
  assert.equal(hasCapability(pro, 'trading.admin'), false);
  assert.equal(hasCapability(admin, 'trading.admin'), true);
});

test('Home and Trading presentation differ safely by tier', () => {
  const freeHome = buttons(mainAlphaMenu(accessProfileForTier('free')));
  const proHome = buttons(mainAlphaMenu(accessProfileForTier('pro')));
  const adminHome = buttons(mainAlphaMenu(accessProfileForTier('admin')));
  const publicTrading = buttons(tradingMenu(accessProfileForTier('pro')));
  const adminTrading = buttons(tradingMenu(accessProfileForTier('admin')));

  assert.ok(freeHome.some(button => button.text === '🐋 Wallets'));
  assert.ok(proHome.some(button => button.text === '🐋 Wallets'));
  assert.ok(adminHome.some(button => button.callback_data === 'ADMIN_TERMINAL_REFRESH'));
  assert.deepEqual(publicTrading.map(button => button.callback_data), ['OPPORTUNITY_CENTER', 'MAIN_MENU']);
  assert.ok(adminTrading.some(button => button.callback_data === 'ADMIN_TRADE_SETTINGS'));
  assert.equal(publicTrading.some(button => /wallet|position|automation|win rate/i.test(button.text ?? '')), false);
});

test('Free testers can enter every non-admin Intelligence module', () => {
  const free = buttons(intelligenceMenu(accessProfileForTier('free')));
  const pro = buttons(intelligenceMenu(accessProfileForTier('pro')));
  assert.equal(free.some(button => button.callback_data === 'INTEL_SMART_MONEY'), true);
  assert.equal(free.some(button => button.callback_data === 'INTEL_CREATORS'), true);
  assert.equal(free.some(button => button.callback_data === 'INTEL_PERFORMANCE'), true);
  assert.ok(pro.some(button => button.callback_data === 'INTEL_SMART_MONEY'));
});

test('all generated commercial callbacks fit Telegram limit', () => {
  const tiers = ['free', 'pro', 'admin'] as const;
  const generated = tiers.flatMap(tier => [
    ...buttons(mainAlphaMenu(accessProfileForTier(tier))),
    ...buttons(intelligenceMenu(accessProfileForTier(tier))),
    ...buttons(tradingMenu(accessProfileForTier(tier))),
  ]).map(button => button.callback_data).filter(Boolean) as string[];

  generated.push(
    `OPP_VIEW_${'9'.repeat(19)}`,
    `OPP_TRACK_${'9'.repeat(19)}`,
    `OPP_UNTRACK_${'9'.repeat(19)}`,
    `ADMIN_BUY_DEFAULT_${'1'.repeat(44)}`,
    `ADMIN_SELL_100_${'1'.repeat(44)}`,
    `ASX100_${'1'.repeat(44)}`,
  );
  for (const callback of generated) assert.ok(callbackDataByteLength(callback) <= 64, callback);
});

test('production navigation callbacks have registered handlers', async () => {
  const files = await Promise.all([
    '../src/bot/commands.ts',
    '../src/bot/opportunityCenter.ts',
    '../src/bot/opportunityActions.ts',
    '../src/bot/intelligenceCenter.ts',
    '../src/bot/walletTracking.ts',
    '../src/bot/strategyControls.ts',
    '../src/bot/admin/terminal.ts',
    '../src/bot/xIntelligenceAdmin.ts',
  ].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  const handlers = files.join('\n');
  const callbacks = new Set(
    ['free', 'pro', 'admin'].flatMap(tier => [
      ...buttons(mainAlphaMenu(accessProfileForTier(tier as 'free' | 'pro' | 'admin'))),
      ...buttons(intelligenceMenu(accessProfileForTier(tier as 'free' | 'pro' | 'admin'))),
      ...buttons(tradingMenu(accessProfileForTier(tier as 'free' | 'pro' | 'admin'))),
    ]).map(button => button.callback_data).filter(Boolean) as string[],
  );
  for (const callback of callbacks) assert.match(handlers, new RegExp(`bot\\.action\\([^)]*['\"]${callback}['\"]`), callback);
});

test('opportunity detail is friendly, escaped, and has contextual navigation', async () => {
  const detail = await readFile(new URL('../src/bot/opportunityCenter.ts', import.meta.url), 'utf8');
  assert.match(detail, /strategyDisplay\(opportunity\.strategy_key\)/);
  assert.doesNotMatch(detail, /<b>\$\{opportunity\.strategy_key\}/);
  assert.match(detail, /OPP_TRACK_/);
  assert.match(detail, /OPP_UNTRACK_/);
  assert.match(detail, /⬅️.*OPPORTUNITY_CENTER|OPP_BUCKET_/s);
  assert.match(detail, /🏠 Home/);
  assert.match(detail, /escapeHtml\(/);
  assert.equal(strategyDisplay('PONS_RISK').name, 'PONS Risk Monitor');
});

test('watchlist UI persists independently and enforces capability', async () => {
  const actions = await readFile(new URL('../src/bot/opportunityActions.ts', import.meta.url), 'utf8');
  assert.match(actions, /requireCapability\(ctx, 'watchlist\.use'/);
  assert.match(actions, /trackOpportunity\(/);
  assert.match(actions, /untrackOpportunity\(/);
  assert.doesNotMatch(actions, /opportunity_deliveries/);
});

test('payment journey shows destination before accepting input and Cancel clears state', async () => {
  const commands = await readFile(new URL('../src/bot/commands.ts', import.meta.url), 'utf8');
  const selection = commands.indexOf('async function renderSelectedPlan');
  const submission = commands.indexOf('async function beginPaymentSubmission');
  assert.ok(selection >= 0 && submission > selection);
  assert.match(commands.slice(selection, submission), /Payment destination[\s\S]*SUBMIT_PLAN_/);
  assert.match(commands.slice(submission), /setConversationState\(telegramId, 'SUBMIT_PAYMENT_HASH'\)/);
  assert.match(commands, /bot\.action\('UPGRADE_CANCEL'[\s\S]{0,240}clearPaymentInputState\(telegramId\)/);
  assert.match(commands, /isLikelySolanaSignature/);
});

test('privileged production callbacks enforce capability or configured admin identity', async () => {
  const commands = await readFile(new URL('../src/bot/commands.ts', import.meta.url), 'utf8');
  const opportunities = await readFile(new URL('../src/bot/opportunityActions.ts', import.meta.url), 'utf8');
  assert.match(commands, /POSITIONS[\s\S]{0,180}requireCapability\(ctx, 'trading\.admin'/);
  assert.match(commands, /ABXS_[\s\S]{0,240}isAdmin\(telegramId\)/);
  assert.match(commands, /ASX\(25\|50\|100\)_[\s\S]{0,240}isAdmin\(telegramId\)/);
  assert.match(opportunities, /OPP_TRADE_[\s\S]{0,240}requireCapability\(ctx, 'trading\.admin'/);
});

test('tester navigation reaches all non-admin product areas while execution stays private', async () => {
  const [wallets, intelligence, opportunities, delivery, commands] = await Promise.all([
    '../src/bot/walletTracking.ts', '../src/bot/intelligenceCenter.ts', '../src/bot/opportunityCenter.ts',
    '../src/services/opportunityDeliveryService.ts', '../src/bot/commands.ts',
  ].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  for (const callback of ['WALLET_TRACKING', 'WALLET_ACTIVITY_', 'WALLET_INTEL_', 'WALLET_INTEL_ANALYZE_']) assert.match(wallets, new RegExp(callback));
  for (const callback of ['INTEL_SMART_MONEY', 'INTEL_CREATORS', 'INTEL_PERFORMANCE']) assert.match(intelligence, new RegExp(callback));
  assert.match(opportunities, /OPP_WATCHLIST/);
  assert.match(delivery, /return hasCapability\(access, 'opportunities\.realtime'\)/);
  assert.doesNotMatch(delivery.slice(delivery.indexOf('function userCanReceiveOpportunity'), delivery.indexOf('async function loadOpportunity')), /access\.tier|OPPORTUNITY_DELIVERY_MODE/);
  assert.match(commands, /POSITIONS[\s\S]{0,180}requireCapability\(ctx, 'trading\.admin'/);
  assert.match(commands, /AUTO_TRADE_STATUS[\s\S]{0,180}!isAdmin\(telegramId\)/);
});
