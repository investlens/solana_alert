import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { startPonsShadowServices } from '../src/chains/robinhood/ponsShadowStartup.js';

function harness(enabled: boolean) {
  let sniperStarts = 0;
  let trackerStarts = 0;
  const logs: string[] = [];
  const started = startPonsShadowServices(enabled, {
    startSniper: () => { sniperStarts += 1; },
    startTracker: () => { trackerStarts += 1; },
    log: message => logs.push(message),
  });
  return { started, sniperStarts, trackerStarts, logs };
}

test('unset/default and explicit false keep both legacy shadow services stopped', async () => {
  const configSource = await readFile(new URL('../src/config.ts', import.meta.url), 'utf8');
  assert.match(configSource, /ponsShadowEnabled:\s*bool\('PONS_SHADOW_ENABLED', false\)/);
  for (const enabled of [false, Boolean(undefined)]) {
    const result = harness(enabled);
    assert.deepEqual(result, {
      started: false,
      sniperStarts: 0,
      trackerStarts: 0,
      logs: ['[PonsShadow] Disabled by PONS_SHADOW_ENABLED=false'],
    });
  }
});

test('explicit true preserves startup of both legacy shadow services', () => {
  assert.deepEqual(harness(true), {
    started: true,
    sniperStarts: 1,
    trackerStarts: 1,
    logs: [],
  });
});

test('main gates only shadow startup while live Pons and Robinhood boost remain independent', async () => {
  const [main, liveCli] = await Promise.all([
    readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/runPonsLiveDev.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(main, /startPonsShadowServices\(config\.ponsShadowEnabled/);
  assert.match(main, /startRobinhoodBoostObserver\(\)/);
  assert.match(liveCli, /createPonsLiveLaunchRouter/);
  assert.match(liveCli, /PONS_LIVE_INTELLIGENCE_ENABLED/);
  assert.doesNotMatch(liveCli, /PONS_SHADOW_ENABLED|ponsShadowEnabled|startPonsShadowServices/);
});

test('shadow switch does not alter trading safety configuration', async () => {
  const configSource = await readFile(new URL('../src/config.ts', import.meta.url), 'utf8');
  assert.match(configSource, /adminTradingEnabled:\s*bool\('ADMIN_TRADING_ENABLED', false\)/);
  assert.match(configSource, /autoTradeMode:\s*\(process\.env\.AUTO_TRADE_MODE \?\? 'paper'\)/);
});
