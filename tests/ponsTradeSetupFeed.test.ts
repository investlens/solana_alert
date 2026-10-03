import { recordLaunchSocialEligibility } from '../src/chains/robinhood/alertEligibilityState.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PonsLaunch } from '../src/chains/robinhood/ponsHistoricalLaunchScanner.js';
import { buildTradeSetupText, isTradeSetupLaunchAdmissible, queuePonsTradeSetup, tradeSetupSchedulingStateForTests, resetTradeSetupSchedulingForTests, tickTradeSetupForTests } from '../src/chains/robinhood/ponsTradeSetupFeed.js';
import { PONS_CONTRACTS } from '../src/chains/robinhood/ponsContracts.js';

const now = Date.parse('2026-10-01T07:00:00Z');
const address = '0x' + '1'.repeat(40);
const launch = { chain: 'robinhood', protocol: 'pons', protocol_version: 'v2-current',
  factory_address: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e', token_address: address,
  curve_address: address, deployer_address: address, pair_token_address: PONS_CONTRACTS.weth,
  block_timestamp: new Date(now).toISOString() } as PonsLaunch;

test('only live verified PONS WETH curves enter the setup watcher', () => {
  assert.equal(isTradeSetupLaunchAdmissible(launch, now), true);
  assert.equal(isTradeSetupLaunchAdmissible({ ...launch, pair_token_address: '0x' + '0'.repeat(40) }, now), true);
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

test('failed social candidates release full watch slots and a deferred eligible launch can enter', () => {
  resetTradeSetupSchedulingForTests();
  const live = { ...launch, block_timestamp: new Date().toISOString() };
  const tokens = Array.from({ length: 11 }, (_, i) => '0x' + (i + 100).toString(16).padStart(40, '0'));
  for (const token of tokens) queuePonsTradeSetup({ ...live, token_address: token });
  assert.equal(tradeSetupSchedulingStateForTests().candidates.length, 10);
  assert.deepEqual(tradeSetupSchedulingStateForTests().deferred, [tokens[10]]);
  for (const token of tokens.slice(0, 10)) recordLaunchSocialEligibility(token, false);
  recordLaunchSocialEligibility(tokens[10], true);
  queuePonsTradeSetup({ ...live, token_address: tokens[10] });
  assert.deepEqual(tradeSetupSchedulingStateForTests().candidates, [tokens[10]]);
  assert.equal(tradeSetupSchedulingStateForTests().deferred.length, 0);
  resetTradeSetupSchedulingForTests();
});


test('already admitted deferred launches survive the five-minute ingress limit without allowing old replay', async () => {
  resetTradeSetupSchedulingForTests();
  const originalNow = Date.now; const start = originalNow();
  let clock = start; Date.now = () => clock;
  const live = { ...launch, block_timestamp: new Date(start).toISOString() };
  const tokens = Array.from({ length: 11 }, (_, i) => '0x' + (i + 200).toString(16).padStart(40, '0'));
  try {
    for (const token of tokens) queuePonsTradeSetup({ ...live, token_address: token });
    clock += 6 * 60_000;
    assert.equal(isTradeSetupLaunchAdmissible(live, clock), false);
    for (const token of tokens.slice(0, 10)) recordLaunchSocialEligibility(token, false);
    await tickTradeSetupForTests();
    assert.deepEqual(tradeSetupSchedulingStateForTests().candidates, [tokens[10]]);
    assert.equal(tradeSetupSchedulingStateForTests().deferred.length, 0);
    queuePonsTradeSetup({ ...live, token_address: '0x' + 'f'.repeat(40) });
    assert.deepEqual(tradeSetupSchedulingStateForTests().candidates, [tokens[10]]);
  } finally { Date.now = originalNow; resetTradeSetupSchedulingForTests(); }
});

test('checkpoint recovery accepts only unexpired verified launches and discards stale trend confirmations', async () => {
  const { restoreSetupWatchCheckpoint } = await import('../src/chains/robinhood/ponsTradeSetupFeed.js');
  resetTradeSetupSchedulingForTests();
  const live = { ...launch, token_address: '0x' + 'a'.repeat(40), block_timestamp: new Date(Date.now()-40*60_000).toISOString() };
  const item = (value: PonsLaunch) => ({ launch:value, launchedAt:Date.parse(value.block_timestamp), trend:{peak:1,low:0.5,previous:null,dip:true,confirmations:2},screenAfter:0 });
  await restoreSetupWatchCheckpoint(async () => ({fetchedAt:new Date().toISOString(),value:{candidates:[item(live),item({...live,token_address:'0x'+'b'.repeat(40),protocol_version:'CUSTOM'}),item({...live,token_address:'0x'+'c'.repeat(40),block_timestamp:new Date(Date.now()-121*60_000).toISOString()})],deferred:[]}}));
  assert.deepEqual(tradeSetupSchedulingStateForTests().candidates,[live.token_address]);
  resetTradeSetupSchedulingForTests();
});

test('recovered trend retains observed levels but requires new consecutive confirmation', async () => {
  const { recoveredSetupTrend } = await import('../src/chains/robinhood/ponsTradeSetupFeed.js');
  assert.deepEqual(recoveredSetupTrend({peak:2,low:1,dip:true,confirmations:2,previous:{at:1,price:1.1,quoteDepth:2}}),
    {peak:2,low:1,dip:true,confirmations:0,previous:null});
  assert.equal(recoveredSetupTrend({peak:NaN,low:1,dip:true,confirmations:2,previous:null}).dip,false);
});
