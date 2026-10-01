import test from 'node:test';
import assert from 'node:assert/strict';
import type { PonsLaunch } from '../src/chains/robinhood/ponsHistoricalLaunchScanner.js';
import { buildTradeSetupText, isTradeSetupLaunchAdmissible } from '../src/chains/robinhood/ponsTradeSetupFeed.js';
import { PONS_CONTRACTS } from '../src/chains/robinhood/ponsContracts.js';

const now = Date.parse('2026-10-01T07:00:00Z');
const address = '0x' + '1'.repeat(40);
const launch = { chain: 'robinhood', protocol: 'pons', protocol_version: 'v2-current',
  factory_address: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e', token_address: address,
  curve_address: address, deployer_address: address, pair_token_address: PONS_CONTRACTS.weth,
  block_timestamp: new Date(now).toISOString() } as PonsLaunch;

test('only live verified PONS WETH curves enter the setup watcher', () => {
  assert.equal(isTradeSetupLaunchAdmissible(launch, now), true);
  for (const change of [{ factory_address: address }, { protocol_version: 'CUSTOM' }, { protocol_version: 'UNKNOWN' },
    { curve_address: null }, { pair_token_address: address }, { token_address: 'invalid' },
    { block_timestamp: 'invalid' }, { block_timestamp: new Date(now - 6 * 60_000).toISOString() },
    { block_timestamp: new Date(now + 1).toISOString() }]) {
    assert.equal(isTradeSetupLaunchAdmissible({ ...launch, ...change }, now), false);
  }
});
test('setup card escapes project text and distinguishes FDV, reserves and execution gaps', () => {
  const text = buildTradeSetupText({ token: address, symbol: '<FAKE>', name: 'Name & Co', age: 35,
    holding: 0.7, burned: null, recovery: 4, depth: 0.3, lowEth: 1e-8, fdvUsd: 4600, creator: address,
    xUrl: 'https://x.com/example', tgUrl: 'https://t.me/example', at: now });
  assert.ok(text.includes('&lt;FAKE&gt;')); assert.ok(text.includes('Name &amp; Co'));
  assert.match(text, /FDV.*\$4,600/); assert.doesNotMatch(text, /Market cap|Safety Score|HIGH_BUY/);
  assert.match(text, /Exit quote \/ slippage.*Not verified/);
  assert.match(text, /Holder concentration \/ linked wallets.*Unavailable/);
  assert.match(text, /Reserve is not a size-specific sell quote/);
  assert.match(text, /Observed low \/ invalidation reference/);
  assert.match(text, /Research setup/);
});
