import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  boostFallbackIdentity,
  deliverAdminBoostFallback,
  recordAcceptedAdminBoostNotification,
  resetRobinhoodBoostFallbackForTests,
} from '../src/chains/robinhood/robinhoodBoostObserver.js';

const token = '0x26DE761468A48B2F939D60755FE5413EE4A9C03E';

test('admin boost fallback sends a new cumulative total once and allows an increase', async () => {
  resetRobinhoodBoostFallbackForTests();
  const sends: string[] = [];
  const send = async (_chatId: string, message: string) => { sends.push(message); return 1; };
  const args = { tokenAddress: token, totalBoostAmount: 100, message: 'BOOST' };

  assert.equal(await deliverAdminBoostFallback(args, { send, adminTelegramId: 'admin', log: () => {} }), true);
  assert.equal(await deliverAdminBoostFallback(args, { send, adminTelegramId: 'admin', log: () => {} }), false);
  assert.equal(await deliverAdminBoostFallback({ ...args, totalBoostAmount: 150 },
    { send, adminTelegramId: 'admin', log: () => {} }), true);
  assert.deepEqual(sends, ['BOOST', 'BOOST']);
  assert.equal(boostFallbackIdentity(token, 100), `${token.toLowerCase()}:100`);
});

test('an accepted normal admin delivery suppresses fallback even if ledger completion later fails', async () => {
  resetRobinhoodBoostFallbackForTests();
  recordAcceptedAdminBoostNotification(token, 500);
  let sends = 0;
  assert.equal(await deliverAdminBoostFallback({ tokenAddress: token, totalBoostAmount: 500, message: 'MAX_BOOST_500_PLUS' }, {
    send: async () => { sends += 1; return 1; }, adminTelegramId: 'admin', log: () => {},
  }), false);
  assert.equal(sends, 0);
});

test('Telegram failure is not marked delivered and remains retryable', async () => {
  resetRobinhoodBoostFallbackForTests();
  const logs: string[] = [];
  let attempts = 0;
  const args = { tokenAddress: token, totalBoostAmount: 200, message: 'BOOST' };
  assert.equal(await deliverAdminBoostFallback(args, {
    send: async () => { attempts += 1; throw new Error('Telegram unavailable'); },
    adminTelegramId: 'admin', log: event => logs.push(event),
  }), false);
  assert.equal(await deliverAdminBoostFallback(args, {
    send: async () => { attempts += 1; return 1; }, adminTelegramId: 'admin', log: event => logs.push(event),
  }), true);
  assert.equal(attempts, 2);
  assert.deepEqual(logs, ['BOOST_DELIVERY_FAILED', 'BOOST_DELIVERED']);
});

test('observer keeps BOOST security gating ahead of durable delivery and late optional enrichment', async () => {
  const source = await readFile(new URL('../src/chains/robinhood/robinhoodBoostObserver.ts', import.meta.url), 'utf8');
  const compact = source.replace(/\s+/g, '');

  assert.match(source, /BOOST_SECURITY_DECISION/);
  assert.match(source, /BOOST_BLOCKED_SECURITY/);
  assert.match(source, /persistOrLoadAlphaSemanticEventRecord/);
  assert.match(source, /deliverAlphaSemanticEvent/);
  assert.match(source, /deliverAdminBoostFallback/);
  assert.match(source, /enrichDeliveredBoostAlert/);
  assert.match(source, /editTelegramMessage/);
  assert.match(source, /BOOST_ALERT_VERIFIED/);
  assert.match(compact, /for\(constboostofboosts\)\{try\{if\(awaitprocessBoost\(boost\)\)/);
  assert.match(compact, /if\(!awaitensureBoostBaseline\(\)\)return;/);

  const processStart = source.indexOf('async function processBoost');
  const processSource = processStart >= 0 ? source.slice(processStart) : source;
  const securityIndex = processSource.indexOf('routeBoostSecurity');
  const persistIndex = processSource.indexOf('persistOrLoadAlphaSemanticEventRecord');
  const deliveryIndex = processSource.indexOf('deliverAlphaSemanticEvent');
  const lateEnrichmentIndex = processSource.indexOf('enrichDeliveredBoostAlert');
  assert.ok(
    securityIndex >= 0 &&
    persistIndex > securityIndex &&
    deliveryIndex > persistIndex &&
    lateEnrichmentIndex > deliveryIndex,
    'BOOST security must run before durable persistence/delivery, with enrichment scheduled only after delivery',
  );

  const enrichStart = source.indexOf('export async function enrichDeliveredBoostAlert');
  const enrichEnd = source.indexOf('export function isMaterialVolumeSurge');
  const enrichSource = enrichStart >= 0 ? source.slice(enrichStart, enrichEnd > enrichStart ? enrichEnd : undefined) : '';
  assert.match(enrichSource, /getRobinhoodMarketSnapshot/);
  assert.match(enrichSource, /queueWaitTimeoutMs: 750/);
  assert.doesNotMatch(processSource.slice(0, deliveryIndex), /getRobinhoodMarketSnapshot/);
});
