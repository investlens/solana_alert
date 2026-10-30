import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { ECHO_WALLETS, SOL_MINT, echoCard } from '../src/echo/signals.js';
import { ECHO_PUMP, ECHO_PUMP_SWAP, extractRpcEchoSignals } from '../src/echo/rpcSignals.js';
import { readQuicknodeEchoConfig } from '../src/echo/quicknodeConfig.js';
import { EchoQueue } from '../src/echo/queue.js';
import { startEchoSubscription } from '../src/echo/subscription.js';
const wallet = Object.keys(ECHO_WALLETS)[0], mint = '4'.repeat(44);
const token = '5'.repeat(44), quoteAccount = '6'.repeat(44);
const signature = '5'.repeat(88), now = 1_800_000_000;
function instruction(side = 'BUY', program = ECHO_PUMP) {
  const accounts = Array(16).fill('11111111111111111111111111111111');
  if (program === ECHO_PUMP) { accounts[2] = mint; accounts[5] = token; accounts[6] = wallet; }
  else { accounts[1] = wallet; accounts[3] = mint; accounts[4] = SOL_MINT; accounts[5] = token; accounts[6] = quoteAccount; }
  return { programId: program, accounts, data: bs58.encode(Buffer.concat([Buffer.from(side === 'BUY' ? '66063d1201daebea' : '33e685a4017f83ad', 'hex'), Buffer.alloc(16)])) };
}
function transaction(side = 'BUY', program = ECHO_PUMP): any {
  const balance = (amount: string) => ({ accountIndex: 1, mint, owner: wallet, uiTokenAmount: { amount, decimals: 6 } });
  return { slot: 42, blockTime: now - 2,
    transaction: { signatures: [signature], message: { accountKeys: [{ pubkey: wallet, signer: true }, { pubkey: token, signer: false }, { pubkey: quoteAccount, signer: false }], instructions: [instruction(side, program)] } },
    meta: { err: null, preTokenBalances: [balance(side === 'BUY' ? '0' : '2000000')], postTokenBalances: [balance(side === 'BUY' ? '2000000' : '0')],
      preBalances: [2e9, 0, 0], postBalances: [side === 'BUY' ? 1e9 : 3e9, 0, 0], innerInstructions: [] } };
}
test('raw JSON RPC Pump buys and sells require instruction identity, signer and balance direction', () => {
  const buy = extractRpcEchoSignals(transaction(), signature, now);
  assert.equal(buy.length, 1); assert.equal(buy[0].side, 'BUY'); assert.equal(buy[0].tokenAmount, 2);
  assert.equal(buy[0].quoteAmount, 1); assert.match(echoCard(buy[0], now), /includes fees\/rent/);
  assert.equal(extractRpcEchoSignals(transaction('SELL'), signature, now)[0].side, 'SELL');
});
test('parser also accepts web3 PublicKeys, exact-input variants and inner Pump instructions', () => {
  const tx = transaction(); tx.transaction.message.accountKeys.forEach((k: any) => { k.pubkey = new PublicKey(k.pubkey); });
  tx.transaction.message.instructions[0].programId = new PublicKey(ECHO_PUMP);
  tx.transaction.message.instructions[0].accounts = tx.transaction.message.instructions[0].accounts.map((k: string) => new PublicKey(k));
  assert.equal(extractRpcEchoSignals(tx, signature, now).length, 1);
  const exact = transaction(); exact.transaction.message.instructions[0].data = bs58.encode(Buffer.concat([Buffer.from('38fc74089edfcd5f', 'hex'), Buffer.alloc(16)]));
  assert.equal(extractRpcEchoSignals(exact, signature, now).length, 1);
  exact.meta.innerInstructions = [{ index: 0, instructions: exact.transaction.message.instructions }]; exact.transaction.message.instructions = [];
  assert.equal(extractRpcEchoSignals(exact, signature, now).length, 1);
});
test('PumpSwap uses owned quote-account delta and withholds ambiguous multi-trade attribution', () => {
  const tx = transaction('BUY', ECHO_PUMP_SWAP);
  for (const [field, amount] of [['preTokenBalances', '1000000000'], ['postTokenBalances', '0']]) tx.meta[field].push({ accountIndex: 2, mint: SOL_MINT, owner: wallet, uiTokenAmount: { amount, decimals: 9 } });
  const signals = extractRpcEchoSignals(tx, signature, now);
  assert.equal(signals[0].quoteBasis, 'token-account net change'); assert.equal(signals[0].quoteAmount, 1);
  tx.transaction.message.instructions.push(instruction()); assert.deepEqual(extractRpcEchoSignals(tx, signature, now), []);
});
test('gifts, non-signers, unsupported venues, mismatched owners, failed and stale transactions are excluded', () => {
  const mutations = [
    (t: any) => { t.transaction.message.instructions = []; },
    (t: any) => { t.transaction.message.accountKeys[0].signer = false; },
    (t: any) => { t.transaction.message.instructions[0].programId = wallet; },
    (t: any) => { t.meta.postTokenBalances[0].owner = token; },
    (t: any) => { t.meta.postTokenBalances[0].mint = token; },
    (t: any) => { t.meta.postTokenBalances[0].uiTokenAmount.amount = '0'; },
    (t: any) => { t.meta.err = { InstructionError: [0, 'error'] }; },
    (t: any) => { t.blockTime = now - 1801; },
    (t: any) => { t.blockTime = now + 16; },
    (t: any) => { t.transaction.signatures[0] = '6'.repeat(88); },
    (t: any) => { t.transaction.message.instructions[0].data = bs58.encode(Buffer.alloc(24)); },
  ];
  for (const mutate of mutations) { const tx = transaction(); mutate(tx); assert.deepEqual(extractRpcEchoSignals(tx, signature, now), []); }
});
test('new and closed token accounts are supported; unknown quote remains explicit', () => {
  const tx = transaction(); tx.meta.preTokenBalances = []; tx.meta.preBalances = [];
  const signal = extractRpcEchoSignals(tx, signature, now)[0]; assert.equal(signal.quoteAmount, null);
  assert.match(echoCard(signal, now), /Trade:<\/b> Unavailable/);
  const sell = transaction('SELL'); sell.meta.postTokenBalances = [];
  assert.equal(extractRpcEchoSignals(sell, signature, now)[0].side, 'SELL');
});
test('QuickNode config is private, alert-only, encrypted and independent of Helius', () => {
  const env = { ECHO_ENABLED: 'true', ECHO_MODE: 'alerts', ECHO_ADMIN_CHAT_ID: '123', OWNER_CHAT_ID: '123', TELEGRAM_BOT_TOKEN: 'test-only',
    ECHO_STATE_PATH: '/data/echo.json', ECHO_SOLANA_RPC_URL: 'https://example.quiknode.pro/private/', ECHO_SOLANA_WS_URL: 'wss://example.quiknode.pro/private/' };
  assert.equal(readQuicknodeEchoConfig(env).admin, '123');
  for (const overrides of [{ ECHO_MODE: 'live' }, { ECHO_ENABLED: 'false' }, { ECHO_ADMIN_CHAT_ID: '-1' }, { ECHO_SOLANA_WS_URL: '' },
    { ECHO_SOLANA_RPC_URL: 'https://mainnet.helius-rpc.com' }, { ECHO_SOLANA_WS_URL: 'ws://example.quiknode.pro/private/' },
    { ECHO_SOLANA_WS_URL: 'wss://other.quiknode.pro/private/' }]) assert.throws(() => readQuicknodeEchoConfig({ ...env, ...overrides }));
});
class FakeSocket {
  handlers = new Map<string, Array<(value: any) => void>>(); sent: any[] = []; closed = false;
  addEventListener(type: string, callback: (value: any) => void) { this.handlers.set(type, [...(this.handlers.get(type) ?? []), callback]); }
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.closed = true; }
  emit(type: string, value: any = {}) { for (const fn of this.handlers.get(type) ?? []) fn(value); }
  message(value: any) { this.emit('message', { data: JSON.stringify(value) }); }
}
test('configured wallet subscriptions must acknowledge; unknown subscriptions and failed transactions are rejected', () => {
  const socket = new FakeSocket(), received: string[] = []; let ready = 0;
  const timers: Array<() => void> = [];
  const sub = startEchoSubscription({ url: 'wss://test.invalid', socket: () => socket, onSignature: s => received.push(s), onReady: () => { ready++; },
    later: fn => { timers.push(fn); return timers.length as any; }, cancel: () => {} });
  socket.emit('open'); assert.equal(socket.sent.length, Object.keys(ECHO_WALLETS).length);
  for (const request of socket.sent) { assert.equal(request.params[0].mentions.length, 1); assert.equal(request.params[1].commitment, 'confirmed'); }
  socket.message({ id: 1, result: 101 }); socket.message({ id: 1, result: 999 });
  assert.equal(sub.state.acknowledgedWallets, 1);
  for (let id = 2; id <= Object.keys(ECHO_WALLETS).length; id++) socket.message({ id, result: 100 + id });
  assert.equal(ready, 1); assert.equal(sub.state.ready, true);
  const notification = (subscription: number, err: any = null) => ({ method: 'logsNotification', params: { subscription, result: { value: { signature, err } } } });
  socket.message(notification(999)); socket.message(notification(101, {})); assert.deepEqual(received, []);
  socket.message(notification(101)); assert.deepEqual(received, [signature]);
  sub.stop(); socket.message(notification(101)); assert.equal(received.length, 1); assert.equal(sub.state.ready, false);
});
test('disconnects and API subscription errors reconnect with bounded backoff and acknowledge again', () => {
  const sockets: FakeSocket[] = [], timers = new Map<number, { fn: () => void; ms: number }>(); let id = 0;
  const sub = startEchoSubscription({ url: 'wss://test.invalid', socket: () => { const s = new FakeSocket(); sockets.push(s); return s; }, onSignature: () => {}, onReady: () => {},
    later: (fn, ms) => { timers.set(++id, { fn, ms }); return id as any; }, cancel: timer => { timers.delete(Number(timer)); } });
  sockets[0].emit('open'); sockets[0].message({ id: 1, error: { code: -32601 } });
  assert.equal(sub.state.ready, false); assert.equal(sub.state.reconnects, 1); assert.equal(sockets[0].closed, true);
  const reconnect = [...timers.values()].find(x => x.ms === 1000)!; reconnect.fn();
  assert.equal(sockets.length, 2); sockets[1].emit('open'); assert.equal(sockets[1].sent.length, Object.keys(ECHO_WALLETS).length);
  sub.stop();
});
test('queue deduplicates signatures and retries transient errors without dropping work', async () => {
  let calls = 0, time = 0;
  const queue = new EchoQueue(async () => { calls++; if (calls === 1) throw new Error('pending'); }, () => time);
  const signature = '3'.repeat(88);
  queue.add(signature); queue.add(signature); assert.equal(queue.size, 1);
  await queue.tick(); assert.equal(queue.size, 1);
  time += 1200; await queue.tick(); assert.equal(queue.size, 0);
  assert.equal(queue.dropped, 0);
});
test('queue serializes overlapping ticks and holds failures for later recovery', async () => {
  let release!: () => void, calls = 0, time = 0;
  const queue = new EchoQueue(async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); });
  queue.add('3'.repeat(88));
  const work = queue.tick(); await queue.tick(); assert.equal(calls, 1); release(); await work;
  const failing = new EchoQueue(async () => { throw new Error('outage'); }, () => time);
  failing.add('4'.repeat(88));
  for (let i = 0; i < 4; i++) { time += 120_000; await failing.tick(); }
  assert.equal(failing.size, 1); assert.equal(failing.dropped, 0);
});
