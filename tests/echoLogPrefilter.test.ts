import test from 'node:test';
import assert from 'node:assert/strict';
import { mayContainWalletSwap } from '../src/echo/logPrefilter.js';

test('skip unsolicited token transfers and non-trading wallet mentions without fetching transaction', () => {
  assert.equal(mayContainWalletSwap([
    'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]',
    'Program log: Instruction: TransferChecked',
    'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success'
  ]), false);
  assert.equal(mayContainWalletSwap(['Program 11111111111111111111111111111111 invoke [1]']), false);
});
test('accept possible Pump.fun and PumpSwap buys for full on-chain validation', () => {
  for (const id of [
    '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'
  ]) assert.equal(mayContainWalletSwap(['Program '+id+' invoke [2]']), true);
});
test('Jupiter and Raydium route logs are not discarded', () => {
  for (const id of [
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C'
  ]) assert.equal(mayContainWalletSwap(['Program '+id+' invoke [1]']), true);
});
test('unknown provider log formats fail open for audit', () => {
  assert.equal(mayContainWalletSwap(undefined), true);
  assert.equal(mayContainWalletSwap([]), true);
  assert.equal(mayContainWalletSwap(['unexpected log format']), false);
});

test('Pump App routing enters full verification while gift transfers are filtered', () => {
  assert.equal(mayContainWalletSwap(['Program 6Vo3245eszAb5wuqEMw8mGdbfRUdKbHhDHP5LcaGuTAB invoke [1]']), true);
  assert.equal(mayContainWalletSwap(['Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]', 'Program log: Instruction: Transfer']), false);
});
