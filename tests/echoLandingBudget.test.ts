import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEchoLandingBudget } from '../src/echo/landingBudget.js';
test('reasonable priority fee is allowed without broadcasting', () => {
  assert.deepEqual(validateEchoLandingBudget({computeUnitLimit: 300_000, microLamportsPerCu: 100_000}),
    {allowed:true,priorityFeeLamports:30_000,totalLandingLamports:30_000});
});
test('oversized fee, tip and combined costs fail closed', () => {
  assert.equal(validateEchoLandingBudget({computeUnitLimit:300_000,microLamportsPerCu:400_000}).allowed,false);
  assert.equal(validateEchoLandingBudget({computeUnitLimit:300_000,microLamportsPerCu:100_000,jitoTipLamports:110_000}).allowed,false);
  assert.equal(validateEchoLandingBudget({computeUnitLimit:300_000,microLamportsPerCu:300_000,jitoTipLamports:90_000}).allowed,false);
});
test('invalid and unsafe numbers are rejected', () => {
  for (const microLamportsPerCu of [-1,NaN,Infinity,1.2,Number.MAX_SAFE_INTEGER+1])
    assert.equal(validateEchoLandingBudget({computeUnitLimit:300_000,microLamportsPerCu}).allowed,false);
  assert.equal(validateEchoLandingBudget({computeUnitLimit:1_400_001,microLamportsPerCu:1}).allowed,false);
});
