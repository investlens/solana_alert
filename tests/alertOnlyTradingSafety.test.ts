import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('settings layer permanently forces paper mode and disables auto-buy', async () => {
  const source = await read('../src/services/settingsService.ts');
  assert.match(source, /const AUTO_TRADING_PERMANENTLY_DISABLED = true/);
  assert.match(source, /executionMode: AUTO_TRADING_PERMANENTLY_DISABLED \? "paper"/);
  assert.match(source, /adminAutoBuyEnabled: AUTO_TRADING_PERMANENTLY_DISABLED \? false/);
  assert.match(source, /Automatic trading is disabled in AlphaOS alert-only mode/);
});

test('manual external trade link remains available', async () => {
  const source = await read('../src/main.ts');
  assert.match(source, /text: '🟢 Trade'/);
  assert.match(source, /https:\/\/jup\.ag\/swap\/SOL-/);
});

test('automatic trade entry remains behind fail-closed settings barrier', async () => {
  const [main, manager, settings] = await Promise.all([
    read('../src/main.ts'),
    read('../src/core/autoTradeManager.ts'),
    read('../src/services/settingsService.ts'),
  ]);
  assert.match(main, /startAdminAutoTrade\(/);
  assert.match(manager, /if \(!settings\.adminAutoBuyEnabled\)/);
  assert.match(settings, /adminAutoBuyEnabled: AUTO_TRADING_PERMANENTLY_DISABLED \? false/);
});
