import test from 'node:test';
import assert from 'node:assert/strict';
import type { ParsedTransactionWithMeta } from '@solana/web3.js';
import { extractRpcEchoSignals, classifyEchoRejection } from '../src/echo/rpcSignals.js';

const sig = '3'.repeat(88);
const slingoor = '5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';

test('incoming token transfer with no validated swap instruction never becomes a BUY', () => {
  const tx = {
    blockTime: 1000,
    transaction: {
      signatures: [sig],
      message: {
        accountKeys: [{ pubkey: { toBase58: () => slingoor }, signer: false }],
        instructions: [{ programId: { toBase58: () => '11111111111111111111111111111111' } }]
      }
    },
    meta: { err: null, innerInstructions: [], preTokenBalances: [], postTokenBalances: [] }
  } as unknown as ParsedTransactionWithMeta;
  assert.deepEqual(extractRpcEchoSignals(tx, sig, 1001), []);
  assert.equal(classifyEchoRejection(tx, sig, 1001), 'unsupported_program_or_instruction');
});

test('failed or stale transactions are not reported as Slingoor BUYs', () => {
  const tx = {
    blockTime: 1000,
    transaction: { signatures: [sig], message: { accountKeys: [], instructions: [] } },
    meta: { err: { InstructionError: [0, 'Custom'] }, innerInstructions: [], preTokenBalances: [], postTokenBalances: [] }
  } as unknown as ParsedTransactionWithMeta;
  assert.deepEqual(extractRpcEchoSignals(tx, sig, 1001), []);
  assert.deepEqual(extractRpcEchoSignals({...tx, meta: {...tx.meta!, err: null}}, sig, 3000), []);
});
