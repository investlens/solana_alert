import test from 'node:test';
import assert from 'node:assert/strict';
import { echoRpc429CooldownMs } from '../src/echo/rpc429Policy.js';

test('sequential RPC rate limits widen cooldown to fifteen minutes', () => {
  assert.deepEqual([1,2,3,4,5,6].map(n => echoRpc429CooldownMs(n,null)),
    [60_000,120_000,240_000,480_000,900_000,900_000]);
});
test('Retry-After can extend but never shorten provider cooldown', () => {
  assert.equal(echoRpc429CooldownMs(2,'400'),400_000);
  assert.equal(echoRpc429CooldownMs(2,'3'),120_000);
  assert.equal(echoRpc429CooldownMs(1,'9999'),900_000);
  assert.equal(echoRpc429CooldownMs(1,'nonsense'),60_000);
  assert.throws(()=>echoRpc429CooldownMs(0,null),/INVALID_RATE_LIMIT_STREAK/);
});
