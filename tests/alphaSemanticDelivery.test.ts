import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { deliverAlphaSemanticEvent, type UserFacingSemanticEvent } from '../src/services/alphaSemanticDeliveryService.js';
import { accessProfileForTier, hasCapability } from '../src/product/capabilities.js';

const user = (telegram_id: string, tier: 'admin' | 'paid' | 'free') => ({ telegram_id, tier,
  username: null, first_name: null, subscription_status: tier === 'paid' ? 'active' as const : 'none' as const,
  free_trial_used: 0, free_trial_limit: 5, paid_active_until: null, is_blocked: false });

function harness(users = [user('admin', 'admin'), user('pro', 'paid'), user('free', 'free'), user('muted', 'free')]) {
  const reservations = new Set<string>(); const sends: string[] = []; const completed: string[] = [];
  return { sends, completed, dependencies: {
    getUsers: async () => users,
    strategyEnabled: async (telegramId: string) => telegramId !== 'muted',
    reserve: async (event: UserFacingSemanticEvent, recipient: ReturnType<typeof user>) => {
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

test('DEX_PAID uses the same eligible per-user semantic delivery architecture', async () => {
  const run = harness([user('admin', 'admin'), user('pro', 'paid'), user('free', 'free')]);
  const event = { id: 26000, eventIdentity: 'v2:DEX_PAID:26000', type: 'DEX_PAID',
    assetId: '0x2222222222222222222222222222222222222222', chain: 'robinhood' };
  await deliverAlphaSemanticEvent({ event, message: 'DEX PAID' }, run.dependencies);
  assert.deepEqual(run.sends, ['admin', 'pro', 'free']);
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
