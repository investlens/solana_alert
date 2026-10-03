import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_ALERT_FEEDS, isLiveFeedKey, resolveLivePreferences, semanticLiveFeed } from '../src/services/liveAlertPreferences.js';
test('functional feeds have unique keys, chain grouping and preserve explicit mute choices',()=>{
  assert.equal(new Set(LIVE_ALERT_FEEDS.map(feed=>feed.key)).size,LIVE_ALERT_FEEDS.length);
  assert.deepEqual([...new Set(LIVE_ALERT_FEEDS.map(feed=>feed.chain))],['Robinchain / PONS','ARC']);
  const preferences=resolveLivePreferences(new Map([['RH_BOOST',false],['ARC_OPPORTUNITY',false],['DEX_PAID',true],['SOL_DEX_PAID',false]]));
  assert.equal(preferences.RH_BOOST,false);assert.equal(preferences.ARC_OPPORTUNITY,false);assert.equal(preferences.DEX_PAID,true);
  assert.equal(preferences.RH_SOCIAL_MAFIA,true);assert.equal(resolveLivePreferences(new Map()).DEX_PAID,false);
  assert.equal(isLiveFeedKey('SOL_DEX_PAID'),false);
});
test('semantic mappings keep Boost, DEX payment and burns independent from risk warnings',()=>{
  assert.equal(semanticLiveFeed('BOOST_INCREASED','robinhood'),'RH_BOOST');
  assert.equal(semanticLiveFeed('DEX_PAID','robinhood'),'DEX_PAID');
  assert.equal(semanticLiveFeed('VERIFIED_BURN','robinhood'),'RH_SUPPLY_BURN');
  assert.equal(semanticLiveFeed('LIQUIDITY_RISK','robinhood'),null);
  assert.equal(semanticLiveFeed('DANGER','robinhood'),null);
  assert.equal(semanticLiveFeed('DEX_PAID','solana'),null);
});

test('recipient filtering omits muted users without marking them as send failures',async()=>{
  const {enabledLiveRecipients}=await import('../src/services/liveAlertPreferences.js');
  const seen:string[]=[];
  const recipients=await enabledLiveRecipients(['alice','bob','carol'],'RH_SOCIAL_MAFIA',async(user,key)=>{
    seen.push(key);return user==='bob';
  });
  assert.deepEqual(recipients,['bob']);assert.deepEqual(seen,['RH_SOCIAL_MAFIA','RH_SOCIAL_MAFIA','RH_SOCIAL_MAFIA']);
});
