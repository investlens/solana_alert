import test from 'node:test';
import assert from 'node:assert/strict';
import { boostDeliveryIdentities, claimBoostDelivery, releaseUnsentBoostClaim } from '../src/services/boostDeliveryGuard.js';
const token = '0x833a7fa750628b391c35bf384d7706652c7e8202';
test('historically accepted boosts are suppressed across restarts and canonical title changes', async () => {
  let claims = 0;
  const dependencies = { previouslyAccepted: async () => true,
    claim: async () => { claims++; return 'CLAIMED' as const; } };
  assert.equal(await claimBoostDelivery(token, 10, dependencies), 'EXISTS');
  assert.equal(await claimBoostDelivery(token.toUpperCase(), 10, dependencies), 'EXISTS');
  assert.equal(claims, 0);
  assert.deepEqual(boostDeliveryIdentities(token, 10), ['BOOST_DETECTED', 'BOOST_INCREASED', 'MAX_BOOST_500_PLUS']
    .map(type => `v2:BOOST:${token}:${type}:10`));
});

test('only the owned unsent claim can be released; attempted and legacy claims stay deduplicated', async () => {
  const claims = new Map<string,string>();
  const dependencies = {previouslyAccepted:async()=>false,claim:async(key:string,_ttl:number,owner='claimed')=>{
    if(claims.has(key))return 'EXISTS' as const; claims.set(key,owner);return 'CLAIMED' as const;
  }};
  const atomic = async (_script:string,keys:string[],args:string[])=>{
    if(claims.get(keys[0])!==args[0])return 0;claims.delete(keys[0]);return 1;
  };
  assert.equal(await claimBoostDelivery(token,10,dependencies,'owner-a'),'CLAIMED');
  assert.equal(await releaseUnsentBoostClaim(token,10,'owner-b',false,atomic),false);
  assert.equal(await releaseUnsentBoostClaim(token,10,'owner-a',true,atomic),false);
  assert.equal(await claimBoostDelivery(token,10,dependencies,'owner-b'),'EXISTS');
  assert.equal(await releaseUnsentBoostClaim(token,10,'owner-a',false,atomic),true);
  assert.equal(await claimBoostDelivery(token,10,dependencies,'owner-b'),'CLAIMED');
  assert.equal(await releaseUnsentBoostClaim(token,10,'claimed',false,atomic),false);
  assert.equal(await releaseUnsentBoostClaim(token,10,'owner-b',false,async()=>{throw Error('timeout');}),false);
});
test('shared atomic claim prevents concurrent/restarted/ambiguous sends but permits added boosts', async () => {
  const keys = new Set<string>();
  const dependencies = { previouslyAccepted: async () => false,
    claim: async (key: string, ttl: number) => {
      assert.equal(ttl, 30 * 24 * 60 * 60_000);
      if (keys.has(key)) return 'EXISTS' as const;
      keys.add(key); return 'CLAIMED' as const;
    } };
  const results = await Promise.all([claimBoostDelivery(token, 10, dependencies), claimBoostDelivery(token, 10, dependencies)]);
  assert.deepEqual(results.sort(), ['CLAIMED', 'EXISTS']);
  // No process-local state survives: Redis claim still protects a partial/ambiguous delivery.
  assert.equal(await claimBoostDelivery(token, 10, { ...dependencies }), 'EXISTS');
  assert.equal(await claimBoostDelivery(token, 20, dependencies), 'CLAIMED');
});
test('database errors and Redis ambiguity fail closed', async () => {
  assert.equal(await claimBoostDelivery(token, 10, {
    previouslyAccepted: async () => { throw new Error('timeout'); }, claim: async () => 'CLAIMED',
  }), 'UNAVAILABLE');
  assert.equal(await claimBoostDelivery(token, 10, {
    previouslyAccepted: async () => false, claim: async () => 'UNAVAILABLE',
  }), 'UNAVAILABLE');
});
