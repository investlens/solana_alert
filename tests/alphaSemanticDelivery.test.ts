import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { deliverAlphaSemanticEvent, type UserFacingSemanticEvent } from '../src/services/alphaSemanticDeliveryService.js';
import { accessProfileForTier, hasCapability } from '../src/product/capabilities.js';
import { defaultStrategyEnabledForUser } from '../src/services/strategyService.js';

const user = (telegram_id: string, tier: 'admin' | 'paid' | 'free') => ({ telegram_id, tier,
  username: null, first_name: null, subscription_status: tier === 'paid' ? 'active' as const : 'none' as const,
  free_trial_used: 0, free_trial_limit: 5, paid_active_until: null, is_blocked: false });

function harness(users = [user('admin', 'admin'), user('pro', 'paid'), user('free', 'free'), user('muted', 'free')],
  preferences: Record<string, Record<string, boolean>> = {}) {
  const reservations = new Set<string>(); const reservationAttempts: string[] = []; const sends: string[] = []; const completed: string[] = [];
  return { sends, completed, reservationAttempts, dependencies: {
    getUsers: async () => users,
    strategyEnabled: async (telegramId: string, strategyKey: string) =>
      preferences[telegramId]?.[strategyKey] ?? (telegramId !== 'muted' && defaultStrategyEnabledForUser(strategyKey)),
    reserve: async (event: UserFacingSemanticEvent, recipient: ReturnType<typeof user>) => {
      reservationAttempts.push(recipient.telegram_id);
      const key = `${event.id}:${recipient.telegram_id}`; if (reservations.has(key)) return false; reservations.add(key); return true;
    },
    complete: async (_event: UserFacingSemanticEvent, recipient: ReturnType<typeof user>) => { completed.push(recipient.telegram_id); },
    release: async () => {}, sentUnconfirmed: async () => {},
    send: async (telegramId: string) => { sends.push(telegramId); }, blocked: async () => {},
  } };
}

test('BOOST and MAJOR BOOST fan out once to Admin, Pro and Free while honoring mute', async () => {
  for (const [id, message] of [[25002, 'BOOST'], [25003, 'MAJOR BOOST']] as const) {
    const run = harness();
    const event = { id, eventIdentity: `v2:BOOST:${id}`, type: 'BOOST', assetId: '0x1111111111111111111111111111111111111111',
      chain: 'robinhood', strategyKey: 'PONS_BREAKOUT' };
    assert.deepEqual(await deliverAlphaSemanticEvent({ event, message }, run.dependencies), { delivered: 3, failed: 0 });
    assert.deepEqual(run.sends, ['admin', 'pro', 'free']);
    assert.deepEqual(run.completed, ['admin', 'pro', 'free']);
    await deliverAlphaSemanticEvent({ event, message }, run.dependencies);
    assert.deepEqual(run.sends, ['admin', 'pro', 'free'], 'same semantic event must not duplicate per user');
  }
});

test('DEX_PAID defaults off and only explicit ON reserves and sends, including for Admin', async () => {
  const run = harness([user('admin', 'admin'), user('pro', 'paid'), user('free', 'free')], {
    admin: { DEX_PAID: false }, pro: { DEX_PAID: true }, free: { DEX_PAID: false },
  });
  const event = { id: 26000, eventIdentity: 'v2:DEX_PAID:26000', type: 'DEX_PAID',
    assetId: '0x2222222222222222222222222222222222222222', chain: 'robinhood' };
  await deliverAlphaSemanticEvent({ event, message: 'DEX PAID' }, run.dependencies);
  assert.deepEqual(run.reservationAttempts, ['pro']);
  assert.deepEqual(run.sends, ['pro']);
  assert.deepEqual(run.completed, ['pro']);
  await deliverAlphaSemanticEvent({ event, message: 'DEX PAID' }, run.dependencies);
  assert.deepEqual(run.sends, ['pro'], 'deterministic semantic delivery must remain deduplicated');
});

test('DEX_PAID absent preference reserves nothing while BOOST preference behavior is unchanged', async () => {
  const users = [user('admin', 'admin'), user('pro', 'paid'), user('free', 'free')];
  const dex = harness(users);
  await deliverAlphaSemanticEvent({ event: { id: 26002, eventIdentity: 'v2:DEX_PAID:26002', type: 'DEX_PAID',
    assetId: '0x2222222222222222222222222222222222222222', chain: 'robinhood' }, message: 'DEX PAID' }, dex.dependencies);
  assert.deepEqual(dex.reservationAttempts, []);
  assert.deepEqual(dex.sends, []);

  const boost = harness(users);
  await deliverAlphaSemanticEvent({ event: { id: 26003, eventIdentity: 'v2:BOOST:26003', type: 'BOOST',
    assetId: '0x2222222222222222222222222222222222222222', chain: 'robinhood' }, message: 'BOOST' }, boost.dependencies);
  assert.deepEqual(boost.sends, ['admin', 'pro', 'free']);
});

test('X_REPUTED_MENTION absent and explicit OFF reserve nothing while explicit ON has no Admin bypass', async () => {
  const users = [user('admin', 'admin'), user('pro', 'paid'), user('free', 'free')];
  const event = { id: 26004, eventIdentity: 'v2:X_REPUTED_MENTION:account:post:token', type: 'X_REPUTED_MENTION',
    assetId: '0x2222222222222222222222222222222222222222', chain: 'robinhood' };
  const absent = harness(users);
  await deliverAlphaSemanticEvent({ event, message: 'X MENTION' }, absent.dependencies);
  assert.deepEqual(absent.reservationAttempts, []); assert.deepEqual(absent.sends, []);

  const explicit = harness(users, { admin: { X_REPUTED_MENTION: false }, pro: { X_REPUTED_MENTION: true },
    free: { X_REPUTED_MENTION: false } });
  await deliverAlphaSemanticEvent({ event, message: 'X MENTION' }, explicit.dependencies);
  assert.deepEqual(explicit.reservationAttempts, ['pro']); assert.deepEqual(explicit.sends, ['pro']);
});

test('one recipient failure cannot starve later eligible testers', async () => {
  const run = harness([user('admin', 'admin'), user('free', 'free')]);
  const originalReserve = run.dependencies.reserve;
  run.dependencies.reserve = async (event, recipient) => {
    if (recipient.telegram_id === 'admin') throw new Error('temporary reservation failure');
    return originalReserve(event, recipient);
  };
  const event = { id: 26001, eventIdentity: 'v2:BOOST:26001', type: 'BOOST',
    assetId: '0x3333333333333333333333333333333333333333', chain: 'robinhood' };
  assert.deepEqual(await deliverAlphaSemanticEvent({ event, message: 'BOOST' }, run.dependencies), { delivered: 1, failed: 1 });
  assert.deepEqual(run.sends, ['free']);
});

test('tester fanout never grants private trading and internal observations have no broadcaster', async () => {
  assert.equal(hasCapability(accessProfileForTier('free'), 'trading.admin'), false);
  assert.equal(hasCapability(accessProfileForTier('pro'), 'trading.admin'), false);
  const commands = await readFile(new URL('../src/bot/commands.ts', import.meta.url), 'utf8');
  const opportunityActions = await readFile(new URL('../src/bot/opportunityActions.ts', import.meta.url), 'utf8');
  assert.match(commands, /AUTO_TRADE_STATUS[\s\S]{0,180}!isAdmin\(telegramId\)/);
  assert.match(opportunityActions, /OPP_TRADE_[\s\S]{0,240}requireCapability\(ctx, 'trading\.admin'/);
  const callSites = await Promise.all([
    '../src/chains/robinhood/robinhoodBoostObserver.ts', '../src/chains/robinhood/robinhoodObserver.ts',
    '../src/chains/robinhood/security/devPostAlertWatcher.ts', '../src/chains/robinhood/ponsShadowOutcomeTracker.ts',
  ].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  const deliveryCalls = callSites.join('\n').match(/deliverAlphaSemanticEvent\(\{[\s\S]{0,180}?type:\s*['"]([^'"]+)/g) ?? [];
  assert.equal(deliveryCalls.some(call => /COOLING|WEAKENING|DANGER/.test(call)), false);
});

test('semantic delivery migration provides durable per-user reservation and dedup', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260828120000_alpha_alert_event_deliveries.sql', import.meta.url), 'utf8');
  assert.match(sql, /unique \(alert_event_id, telegram_id, delivery_channel\)/);
  assert.match(sql, /reserve_alpha_semantic_delivery/);
  assert.match(sql, /metadata ->> 'state' = 'RESERVED'/);
  assert.doesNotMatch(sql, /on delete cascade|drop table|truncate/i);
});

test('DEX_PAID UI and delivery share the durable database-backed preference key', async () => {
  assert.equal(defaultStrategyEnabledForUser('DEX_PAID'), false);
  assert.equal(defaultStrategyEnabledForUser('PONS_BREAKOUT'), true);
  const [delivery, strategies, controls, observer] = await Promise.all([
    readFile(new URL('../src/services/alphaSemanticDeliveryService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/strategyService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/bot/strategyControls.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/chains/robinhood/robinhoodObserver.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(delivery, /event\.type === 'DEX_PAID'.*DEX_PAID_STRATEGY_KEY/);
  assert.match(controls, /STRAT_TOGGLE_\$\{strategy\.strategy_key\}/);
  assert.match(strategies, /strategy_key: args\.strategyKey[\s\S]*onConflict: 'telegram_id,strategy_key'/);
  assert.match(strategies, /eq\('telegram_id', telegramId\)[\s\S]*eq\('strategy_key', strategyKey\)/);
  assert.doesNotMatch(strategies, /Map<string, boolean>\(\).*cache|preferenceCache/);
  assert.ok(observer.indexOf('persistOrLoadAlphaSemanticEventRecord({') < observer.indexOf("eventIdentity: semanticEvent.event_identity, type: 'DEX_PAID'"),
    'internal semantic persistence must precede preference-gated delivery');
});
