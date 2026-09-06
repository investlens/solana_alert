import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  canStartNewTrade,
  getTradingRestorationStatus,
  isAutoTradePaused,
  resetTradingRestorationForTests,
  restoreOpenTrades,
  restoreOpenTradesForStartup,
  resumeAutoTrade,
} from '../src/core/autoTradeManager.js';

test('successful position restoration retains prior behavior and marks trading state ready', async () => {
  resetTradingRestorationForTests();
  let calls = 0;
  await restoreOpenTrades({ restorePositions: async () => { calls += 1; return []; } });
  assert.equal(calls, 1);
  assert.equal(getTradingRestorationStatus(), 'READY');
  assert.equal(isAutoTradePaused(), false);
});

test('PGRST002 restoration failure is contained and does not become an unhandled rejection', async () => {
  resetTradingRestorationForTests();
  const logs: string[] = [];
  await assert.doesNotReject(async () => {
    const restored = await restoreOpenTradesForStartup({
      restore: async () => { throw { code: 'PGRST002', message: 'Could not query the database for the schema cache. Retrying.' }; },
      log: message => logs.push(message),
    });
    assert.equal(restored, false);
  });
  assert.equal(getTradingRestorationStatus(), 'FAILED');
  assert.equal(isAutoTradePaused(), true);
  assert.match(logs[0], /PGRST002.*schema cache/);
});

test('failed restoration remains fail-closed after ordinary trading resume', async () => {
  resetTradingRestorationForTests();
  await restoreOpenTradesForStartup({ restore: async () => { throw new Error('upstream timeout'); }, log: () => {} });
  resumeAutoTrade();
  assert.equal(isAutoTradePaused(), false);
  assert.equal(getTradingRestorationStatus(), 'FAILED');
  assert.equal(await canStartNewTrade('token-after-failed-restore'), false);
});

test('trading-disabled startup can continue to unrelated services after restore failure', async () => {
  resetTradingRestorationForTests();
  let unrelatedStarted = false;
  await restoreOpenTradesForStartup({ restore: async () => { throw new Error('PGRST002'); }, log: () => {} });
  unrelatedStarted = true;
  assert.equal(unrelatedStarted, true);
  assert.equal(getTradingRestorationStatus(), 'FAILED');
});

test('main awaits contained restoration before constructing independent startup tasks', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.equal((source.match(/await restoreOpenTradesForStartup\(\)/g) ?? []).length, 1);
  assert.ok(source.indexOf('await restoreOpenTradesForStartup()') < source.indexOf('const tasks = ['));
  assert.doesNotMatch(source, /await restoreOpenTrades\(\)/);
});
