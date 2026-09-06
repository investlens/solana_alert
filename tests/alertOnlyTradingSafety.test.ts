import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  adminBuyToken,
  adminSellTokenPercent,
  adminSellTokenPercentWithRetry,
  ONCHAIN_ADMIN_TRADING_PERMANENTLY_DISABLED,
} from '../src/core/adminTrading.js';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('settings layer permanently forces paper mode and disables auto-buy', async () => {
  const source = await read('../src/services/settingsService.ts');
  assert.match(source, /const AUTO_TRADING_PERMANENTLY_DISABLED = true/);
  assert.match(source, /executionMode: AUTO_TRADING_PERMANENTLY_DISABLED \? "paper"/);
  assert.match(source, /adminAutoBuyEnabled: AUTO_TRADING_PERMANENTLY_DISABLED \? false/);
  assert.match(source, /Automatic trading is disabled in AlphaOS alert-only mode/);
});

test('execution layer permanently rejects every on-chain buy and sell entry point', async () => {
  assert.equal(ONCHAIN_ADMIN_TRADING_PERMANENTLY_DISABLED, true);
  await assert.rejects(adminBuyToken({ outputMint: 'test', amountSol: 1 }), /permanently disabled; alerts only/);
  await assert.rejects(adminSellTokenPercent({ inputMint: 'test', percent: 100 }), /permanently disabled; alerts only/);
  await assert.rejects(adminSellTokenPercentWithRetry({ inputMint: 'test', percent: 100 }), /permanently disabled; alerts only/);
});

test('execution layer contains no transaction submission path', async () => {
  const source = await read('../src/core/adminTrading.ts');
  assert.doesNotMatch(source, /sendTransaction\s*\(/);
  assert.doesNotMatch(source, /VersionedTransaction/);
  assert.doesNotMatch(source, /api\.jup\.ag\/swap/);
});

test('manual external trade link remains available', async () => {
  const source = await read('../src/main.ts');
  assert.match(source, /text: '🟢 Trade'/);
  assert.match(source, /https:\/\/jup\.ag\/swap\/SOL-/);
});

test('legacy automatic trade caller cannot reach on-chain execution', async () => {
  const [main, settings, execution] = await Promise.all([
    read('../src/main.ts'),
    read('../src/services/settingsService.ts'),
    read('../src/core/adminTrading.ts'),
  ]);
  assert.match(main, /startAdminAutoTrade\(/);
  assert.match(settings, /adminAutoBuyEnabled: AUTO_TRADING_PERMANENTLY_DISABLED \? false/);
  assert.match(execution, /ONCHAIN_ADMIN_TRADING_PERMANENTLY_DISABLED = true/);
  assert.match(execution, /throw tradingDisabledError\(\)/);
});
