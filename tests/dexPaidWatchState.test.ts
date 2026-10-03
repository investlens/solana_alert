import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreDexPaidWatch,snapshotDexPaidWatch,seedDexPaidWatch,dexPaidWatchLimit,recentDexPayment,DEX_PAID_PAYMENT_MAX_AGE_SECONDS} from '../src/chains/robinhood/dexPaidWatchState.js';
const now=Date.now();
const token={chain:'robinhood' as const,tokenAddress:'0x'+'a'.repeat(40),discoveredAt:now-1000,source:'PONS' as const,sourceType:'LAUNCHPAD' as const,sources:[]};
test('restart checkpoint preserves scheduling and strips bulky unneeded metadata',()=>{
 const original={token:{...token,metadata:{image:'junk',nested:100}},lastSeenAt:now-1000,lastCheckedAt:now-500};
 const restored=restoreDexPaidWatch(snapshotDexPaidWatch([original],now,24),now+1000,24);
 assert.equal(restored.length,1);assert.equal(restored[0].lastCheckedAt,original.lastCheckedAt);
 assert.equal(restored[0].token.metadata,undefined);
 assert.equal(restoreDexPaidWatch({version:1,candidates:[{...original,lastSeenAt:now-1800000}]},now,24).length,0);
});
test('watch recovery rejects malformed, future, cross-chain and custom candidates',()=>{
 for (const changed of [{token:{...token,chain:'arc'}},{token:{...token,source:'OTHER'}},{lastSeenAt:now+1},{lastCheckedAt:now+1},{token:{...token,tokenAddress:'junk'}}]) {
  assert.equal(restoreDexPaidWatch({version:1,candidates:[{token,lastSeenAt:now,lastCheckedAt:0,...changed}]},now,24).length,0);
 }
});
test('bounded queue rotation fits freshness with a latency margin and rejects stale payments',()=>{
 const limit=dexPaidWatchLimit(30000,2);
 assert.ok(limit<=24);assert.ok(Math.ceil(limit/2)*30<=DEX_PAID_PAYMENT_MAX_AGE_SECONDS-60);
 assert.equal(recentDexPayment((now-30000)/1000,now),true);
 assert.equal(recentDexPayment((now-(DEX_PAID_PAYMENT_MAX_AGE_SECONDS+1)*1000)/1000,now),false);
 assert.equal(recentDexPayment((now+60000)/1000,now),false);
});
test('cold start seeds only recent verified factory launches from the existing Redis queue',()=>{
 const factory='0x'+'b'.repeat(40);
 const launch={chain:'robinhood',token_address:token.tokenAddress,factory_address:factory,block_timestamp:new Date(now-1000).toISOString()};
 assert.equal(seedDexPaidWatch([{launch}],now,24,[factory]).length,1);
 assert.equal(seedDexPaidWatch([{launch}],now,24,[]).length,0);
 assert.equal(seedDexPaidWatch([{launch:{...launch,block_timestamp:new Date(now-1800001).toISOString()}}],now,24,[factory]).length,0);
});
