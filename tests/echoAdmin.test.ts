import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ECHO_WALLETS, extractEchoSignals, openPaperStop, updatePaperStop, SOL_MINT, echoCard } from '../src/echo/signals.js';
import { EchoStore } from '../src/echo/store.js';
import { deliverEchoBatch, type EchoDeliveryDependencies } from '../src/echo/delivery.js';
import { authenticEchoHeader, readEchoConfig } from '../src/echo/config.js';
const wallet = Object.keys(ECHO_WALLETS)[0], mint = Object.keys(ECHO_WALLETS)[1];
const sig = '5'.repeat(88), now = 1_800_000_000;
function trade() { return { type: 'SWAP', signature: sig, timestamp: now - 2, transactionError: null,
  events: { swap: { nativeInput: { userAccount: wallet, amount: '1000000000' },
    tokenOutputs: [{ userAccount: wallet, mint, rawTokenAmount: { tokenAmount: '2000000', decimals: 6 } }] } } }; }

test('receiver fails closed on live modes, public chats, missing auth and invalid configuration', () => {
  const env = { ECHO_ENABLED: 'true', ECHO_MODE: 'alerts', OWNER_CHAT_ID: '123', ECHO_ADMIN_CHAT_ID: '123', ECHO_WEBHOOK_AUTH: 'x'.repeat(32),
    TELEGRAM_BOT_TOKEN: 'test-only', ECHO_SOLANA_RPC_URL: 'https://example.invalid', ECHO_STATE_PATH: '/data/echo.json' };
  assert.equal(readEchoConfig(env).admin, '123');
  for (const override of [{ ECHO_ENABLED: 'false' }, { ECHO_MODE: 'live' }, { ECHO_MODE: 'paper' }, { OWNER_CHAT_ID: '-123', ECHO_ADMIN_CHAT_ID: '-123' },
    { ECHO_ADMIN_CHAT_ID: '456' }, { ECHO_WEBHOOK_AUTH: '' }, { ECHO_SOLANA_RPC_URL: 'http://example.invalid' }, { PORT: 'NaN' }, { ECHO_STATE_PATH: 'relative.json' }]) {
    assert.throws(() => readEchoConfig({ ...env, ...override }));
  }
  assert.equal(authenticEchoHeader(env.ECHO_WEBHOOK_AUTH, env.ECHO_WEBHOOK_AUTH), true);
  assert.equal(authenticEchoHeader('wrong', env.ECHO_WEBHOOK_AUTH), false);
  assert.equal(authenticEchoHeader('y'.repeat(32), env.ECHO_WEBHOOK_AUTH), false);
});

test('Echo identifies wallet-owned buy legs without using fee-payer or receipts', () => {
  const signals = extractEchoSignals(trade(), now);
  assert.equal(signals.length, 1); assert.equal(signals[0].quoteAmount, 1);
  assert.equal(signals[0].tokenAmount, 2); assert.equal(signals[0].side, 'BUY');
  assert.match(echoCard(signals[0], now), /Security not assessed/);
});
test('Echo identifies sells and USDC swaps', () => {
  const tx: any = trade(), leg = tx.events.swap.tokenOutputs[0];
  tx.events.swap = { tokenInputs: [leg], nativeOutput: { userAccount: wallet, amount: 500000000 } };
  assert.equal(extractEchoSignals(tx, now)[0].side, 'SELL');
  tx.events.swap = { tokenInputs: [{ userAccount: wallet, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', rawTokenAmount: { tokenAmount: '10000000', decimals: 6 } }], tokenOutputs: [leg] };
  assert.equal(extractEchoSignals(tx, now)[0].quoteSymbol, 'USDC');
});
test('Echo rejects transfers, failed, stale, future and malformed transactions', () => {
  for (const overrides of [{ type: 'TRANSFER' }, { transactionError: {} }, { timestamp: now - 121 }, { timestamp: now + 16 }, { timestamp: NaN }, { signature: 'bad' }, { events: {} }]) {
    assert.deepEqual(extractEchoSignals({ ...trade(), ...overrides }, now), []);
  }
});
test('Echo rejects airdrops mixed with someone else’s swap and ambiguous legs', () => {
  const tx: any = trade(); tx.events.swap.nativeInput.userAccount = 'unwatched';
  assert.deepEqual(extractEchoSignals(tx, now), []);
  const multi: any = trade(); multi.events.swap.tokenOutputs.push({ ...multi.events.swap.tokenOutputs[0] });
  assert.deepEqual(extractEchoSignals(multi, now), []);
});
test('Echo rejects invalid mint, nonfinite or malformed amounts and token-to-token swaps', () => {
  for (const raw of ['-1', 'NaN', '1e8', 'Infinity', '0', '9'.repeat(400)]) {
    const tx = trade(); tx.events.swap.tokenOutputs[0].rawTokenAmount.tokenAmount = raw;
    assert.deepEqual(extractEchoSignals(tx, now), []);
  }
  const tx: any = trade(); tx.events.swap.tokenOutputs[0].mint = 'bad';
  assert.deepEqual(extractEchoSignals(tx, now), []);
  const other: any = trade(); delete other.events.swap.nativeInput;
  other.events.swap.tokenInputs = [{ userAccount: wallet, mint: Object.keys(ECHO_WALLETS)[2], rawTokenAmount: { tokenAmount: '1', decimals: 0 } }];
  assert.deepEqual(extractEchoSignals(other, now), []);
});
test('Echo allows wrapped SOL, never treats SOL-to-USDC as a candidate token buy', () => {
  const tx: any = trade(); delete tx.events.swap.nativeInput;
  tx.events.swap.tokenInputs = [{ userAccount: wallet, mint: SOL_MINT, rawTokenAmount: { tokenAmount: '1000000000', decimals: 9 } }];
  assert.equal(extractEchoSignals(tx, now).length, 1);
  tx.events.swap.tokenOutputs[0].mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  assert.deepEqual(extractEchoSignals(tx, now), []);
});
test('paper trailing stops never loosen, lock profit at tiers and remain closed after breach', () => {
  assert.equal(updatePaperStop(openPaperStop(100), 120).stop, 100);
  let p = openPaperStop(100); assert.equal(p.stop, 80);
  for (const price of [110, 108, 121, 135, 132, 160, 175, 200]) {
    const next = updatePaperStop(p, price); assert.ok(next.stop >= p.stop); p = next;
  }
  assert.equal(p.stop, 180);
  const closed = updatePaperStop(p, 170); assert.equal(closed.closed, true);
  assert.deepEqual(updatePaperStop(closed, 250), closed);
  assert.throws(() => openPaperStop(0)); assert.throws(() => openPaperStop(1, 100));
  assert.throws(() => updatePaperStop(p, NaN));
});
test('delivery dedup survives restart and corrupt state fails closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'echo-test-'));
  try {
    const path = join(dir, 'state.json'), store = new EchoStore(path); await store.load();
    assert.equal(store.has('a'), false); await store.delivered('a', now);
    const restarted = new EchoStore(path); await restarted.load(); assert.equal(restarted.has('a'), true);
    await restarted.delivered('b', now + 86_401); assert.equal(restarted.has('a'), false);
    await writeFile(path, '{broken'); await assert.rejects(new EchoStore(path).load());
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('delivery confirms before sending, deduplicates replays and retries failed delivery', async () => {
  const ids = new Set<string>(), order: string[] = [];
  const deps: EchoDeliveryDependencies = { now: () => now,
    store: { has: id => ids.has(id), delivered: async id => { order.push('persist'); ids.add(id); } },
    confirmation: async () => { order.push('confirm'); return 'confirmed'; },
    send: async () => { order.push('send'); },
  };
  assert.equal(await deliverEchoBatch([trade(), trade()], deps), 1);
  assert.deepEqual(order, ['confirm', 'send', 'persist']);
  ids.clear(); deps.send = async () => { throw new Error('delivery failed'); };
  await assert.rejects(deliverEchoBatch([trade()], deps)); assert.equal(ids.size, 0);
  deps.send = async () => {}; assert.equal(await deliverEchoBatch([trade()], deps), 1);
});
test('pending, failed and aged-during-confirmation trades never alert', async () => {
  let sent = 0, time = now;
  const deps: EchoDeliveryDependencies = { now: () => time, store: { has: () => false, delivered: async () => {} },
    confirmation: async () => 'pending', send: async () => { sent++; } };
  await assert.rejects(deliverEchoBatch([trade()], deps)); assert.equal(sent, 0);
  deps.confirmation = async () => 'failed'; assert.equal(await deliverEchoBatch([trade()], deps), 0);
  deps.confirmation = async () => { time += 130; return 'confirmed'; };
  assert.equal(await deliverEchoBatch([trade()], deps), 0); assert.equal(sent, 0);
});
