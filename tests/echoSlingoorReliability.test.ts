import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EchoQueue } from '../src/echo/queue.js';
import { ECHO_WALLETS } from '../src/echo/signals.js';
import { validateBuyAdmission, LIVE_EXECUTION_ENABLED, AUTO_SELL_ENABLED, CHAIRMAN_WALLET } from '../src/echo/liveBuyPolicy.js';

const signature = '3'.repeat(88);
const wallet = '5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const mint = '4'.repeat(44);

test('caller registry only contains explicitly tracked valid addresses', () => {
  assert.deepEqual(Object.values(ECHO_WALLETS).sort(), ['Chairman','WHALE · slingoor'].sort());
  assert.equal(Object.keys(ECHO_WALLETS).length, 2);
});
test('Slingoor and Chairman are eligible for paper admission and live execution remains disabled', () => {
  assert.equal(LIVE_EXECUTION_ENABLED, false);
  assert.equal(AUTO_SELL_ENABLED, false);
  const input = { callerWallet: wallet, mint, amountSol: .1, side: 'BUY' as const,
    isVerifiedSwap: true, transactionSignature: signature };
  assert.equal(validateBuyAdmission(input, wallet).allowed, true);
  assert.equal(validateBuyAdmission({ ...input, callerWallet: CHAIRMAN_WALLET }, wallet).allowed, true);
  assert.equal(validateBuyAdmission({ ...input, amountSol: .10001 }, wallet).allowed, false);
  assert.equal(validateBuyAdmission({ ...input, callerWallet: '5'.repeat(44) }, wallet).allowed, false);
  assert.equal(validateBuyAdmission({ ...input, isVerifiedSwap: false }, wallet).allowed, false);
  assert.equal(validateBuyAdmission({ ...input, side: 'SELL' }, wallet).allowed, false);
});
test('pending signatures survive process recreation and are not re-added twice', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'echo-queue-'));
  try {
    const path = join(dir, 'pending.json');
    const first = new EchoQueue(async () => {}, () => 1000, path);
    first.add(signature);
    first.add(signature);
    assert.equal(first.size, 1);
    const seen: string[] = [];
    const second = new EchoQueue(async sig => { seen.push(sig); }, () => 1000, path);
    assert.equal(second.size, 1);
    await second.tick();
    assert.deepEqual(seen, [signature]);
    const third = new EchoQueue(async () => {}, () => 1000, path);
    assert.equal(third.size, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('transient RPC failure is retried without abandoning signature', async () => {
  let now = 0, attempts = 0;
  const q = new EchoQueue(async () => { attempts++; if (attempts < 4) throw Error('429'); }, () => now);
  q.add(signature);
  for (let i = 0; i < 3; i++) { now += 120_000; await q.tick(); assert.equal(q.size, 1); }
  now += 120_000; await q.tick();
  assert.equal(q.size, 0);
  assert.equal(attempts, 4);
});
