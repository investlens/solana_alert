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

test('observer keeps the critical BOOST path independent from Supabase and market-quality gates', async () => {
  const source = await readFile(new URL('../src/chains/robinhood/robinhoodBoostObserver.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /services\/supabase/);
  assert.doesNotMatch(source, /getRobinhoodMarketSnapshot/);
  assert.doesNotMatch(source, /persistOrLoadAlphaSemanticEventRecord/);
  assert.doesNotMatch(source, /deliverAlphaSemanticEvent/);
  assert.match(source, /BOOST_SECURITY_DECISION/);
  assert.match(source, /security\.status\s*===\s*'SCAM'/);
  assert.match(source, /BOOST_BLOCKED_SECURITY/);
  assert.match(source, /securityStatus:security\.status/);
  assert.match(source, /deliverAdminBoostFallback/);
  assert.match(source, /BOOST_ALERT_VERIFIED/);
  assert.match(source, /supabase:'bypassed'/);
  assert.match(source, /for\(const boost of boosts\)\{try\{if\(await processBoost\(boost\)\)/);
  assert.match(source, /if\(!await ensureBoostBaseline\(\)\)return;/);
});
