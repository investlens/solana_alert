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
  assert.match(text, /Social identity.*Not verified/);
  assert.doesNotMatch(text, /Exact CA listed/);
  const noSocials = buildTradeSetupText({ token: address, symbol: 'TEST', name: 'Test', age:35, holding:0.7, burned:null,recovery:4,depth:0.3,lowEth:1e-8,fdvUsd:4600,creator:address,xUrl:null,tgUrl:null,at:now });
  assert.doesNotMatch(noSocials, /href="null"|>X<|>Telegram</);
});

test('graduated setup card never labels USD liquidity or price as ETH reserves', () => {
  const text = buildTradeSetupText({token:address,symbol:'TEST',name:'Test',age:40,holding:1,burned:null,recovery:4,depth:10000,lowEth:0.001,fdvUsd:999,creator:address,xUrl:null,tgUrl:null,at:now,
    market:{source:'DEX',pair:address,price:0.0011,depth:10000,at:now,marketCap:50000,fdv:60000}});
  assert.match(text,/DEX market/); assert.match(text,/Market cap.*\$50,000/);
  assert.match(text,/FDV.*\$60,000/); assert.match(text,/USD\/token/);
  assert.doesNotMatch(text,/ETH\/token|Pre-bond|Curve quote reserve|PONS page snapshot/);
});

test('missing social identity does not discard market candidates or exceed queue limits', () => {
  resetTradeSetupSchedulingForTests();
  const live = { ...launch, block_timestamp: new Date().toISOString() };
  const tokens = Array.from({ length: 21 }, (_, i) => '0x' + (i + 100).toString(16).padStart(40, '0'));
  for (const token of tokens) queuePonsTradeSetup({ ...live, token_address: token });
  assert.equal(tradeSetupSchedulingStateForTests().candidates.length, 20);
  assert.deepEqual(tradeSetupSchedulingStateForTests().deferred, [tokens[20]]);
  for (const token of tokens.slice(0, 20)) recordLaunchSocialEligibility(token, false);
  recordLaunchSocialEligibility(tokens[20], true);
  queuePonsTradeSetup({ ...live, token_address: tokens[20] });
  assert.equal(tradeSetupSchedulingStateForTests().candidates.length, 20);
  assert.deepEqual(tradeSetupSchedulingStateForTests().deferred, [tokens[20]]);
  resetTradeSetupSchedulingForTests();
});


test('already admitted deferred launches survive the five-minute ingress limit without allowing old replay', async () => {
  resetTradeSetupSchedulingForTests();
  const originalNow = Date.now; const start = originalNow();
  let clock = start; Date.now = () => clock;
  const live = { ...launch, block_timestamp: new Date(start).toISOString() };
  const tokens = Array.from({ length: 21 }, (_, i) => '0x' + (i + 200).toString(16).padStart(40, '0'));
  try {
    for (const token of tokens) queuePonsTradeSetup({ ...live, token_address: token });
    clock += 6 * 60_000;
    assert.equal(isTradeSetupLaunchAdmissible(live, clock), false);
    for (const token of tokens.slice(0, 20)) recordLaunchSocialEligibility(token, false);
    recordLaunchSocialEligibility(tokens[20], true);
    await tickTradeSetupForTests(async () => null);
    assert.equal(tradeSetupSchedulingStateForTests().candidates.length, 20);
    assert.ok(tradeSetupSchedulingStateForTests().candidates.includes(tokens[20]));
    assert.equal(tradeSetupSchedulingStateForTests().deferred.length, 1);
    queuePonsTradeSetup({ ...live, token_address: '0x' + 'f'.repeat(40) });
    assert.equal(tradeSetupSchedulingStateForTests().candidates.length, 20);
  } finally { Date.now = originalNow; resetTradeSetupSchedulingForTests(); }
});

test('observes launch history before 30m without entering enrichment or delivery', async () => {
  resetTradeSetupSchedulingForTests();
  const live = { ...launch, block_timestamp: new Date().toISOString() };
  queuePonsTradeSetup(live);
  let reads = 0;
  await tickTradeSetupForTests(async value => {
    reads++;
    return { price: 1, depth: 1, at: Date.now(), source: 'CURVE', pair: value.curve_address!, marketCap: null, fdv: null };
  });
  assert.equal(reads, 1);
  assert.equal(tradeSetupSchedulingStateForTests().candidates.length, 1);
  resetTradeSetupSchedulingForTests();
});

test('unavailable market reads rotate fairly within ten-check budget', async () => {
  resetTradeSetupSchedulingForTests();
  const original = Date.now; let clock = original(); Date.now = () => clock;
  try {
    for (let i=1; i<=20; i++) queuePonsTradeSetup({ ...launch, token_address: '0x'+i.toString(16).padStart(40,'0'), block_timestamp:new Date(clock).toISOString() });
    const seen: string[] = [];
    const read = async (value: PonsLaunch) => { seen.push(value.token_address); return null; };
    await tickTradeSetupForTests(read); assert.equal(seen.length, 10);
    clock += 60_000;
    await tickTradeSetupForTests(read); assert.equal(new Set(seen).size, 20);
  } finally { Date.now=original; resetTradeSetupSchedulingForTests(); }
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

test('three flat mature watches rotate without increasing cycle reads or queue size', async () => {
  resetTradeSetupSchedulingForTests();
  const original=Date.now; let clock=original(); Date.now=()=>clock;
  const tokens=Array.from({length:25},(_,i)=>'0x'+(i+500).toString(16).padStart(40,'0'));
  try {
    for(const token of tokens) queuePonsTradeSetup({...launch,token_address:token,block_timestamp:new Date(clock).toISOString()});
    clock+=31*60_000; let reads=0;
    await tickTradeSetupForTests(async()=>{reads++;return null;});
    const state=tradeSetupSchedulingStateForTests();
    assert.equal(state.candidates.length,20); assert.equal(state.deferred.length,2);
    assert.equal(reads,10); for(const token of tokens.slice(20,23)) assert.ok(state.candidates.includes(token));
  } finally {Date.now=original;resetTradeSetupSchedulingForTests();}
});

test('expired watches yield capacity before selecting any provider checks', async () => {
  resetTradeSetupSchedulingForTests();
  const original=Date.now; let clock=original(); Date.now=()=>clock;
  try {
    queuePonsTradeSetup({...launch,block_timestamp:new Date(clock).toISOString()});
    clock+=121*60_000;let reads=0;
    await tickTradeSetupForTests(async()=>{reads++;return null;});
    assert.equal(reads,0);assert.equal(tradeSetupSchedulingStateForTests().candidates.length,0);
  } finally {Date.now=original;resetTradeSetupSchedulingForTests();}
});
