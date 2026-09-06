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
  assert.equal(await deliverAdminBoostFallback({ tokenAddress: token, totalBoostAmount: 500, message: 'MAJOR_BOOST' }, {
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
  assert.deepEqual(logs, ['BOOST_FALLBACK_FAILED', 'BOOST_FALLBACK_SENT']);
});

test('observer keeps optional database failures from terminating the critical boost path', async () => {
  const source = await readFile(new URL('../src/chains/robinhood/robinhoodBoostObserver.ts', import.meta.url), 'utf8');
  assert.match(source, /Save failed:[\s\S]{0,260}return `preindex:/);
  assert.match(source, /Semantic event unavailable; admin fallback eligible/);
  assert.match(source, /Semantic delivery unavailable; admin fallback eligible/);
  assert.match(source, /Optional volume event unavailable/);
  assert.match(source, /onTelegramAccepted:[\s\S]{0,300}recordAcceptedAdminBoostNotification/);
  assert.match(source, /stage === 'telegram_send'[\s\S]{0,220}adminTelegramFailed = true/);
  assert.match(source, /for \([\s\S]{0,120}const boost[\s\S]{0,180}try \{[\s\S]{0,180}processBoost/);
  assert.match(source, /if \(!await ensureBoostBaseline\(\)\) return;/);
  assert.match(source, /storedTotal \?\? boost\.totalAmount/);
});
