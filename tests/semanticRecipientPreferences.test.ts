import test from 'node:test';import assert from 'node:assert/strict';
import {semanticRecipientPreferences} from '../src/services/semanticRecipientPreferences.js';
test('one registry read and one bulk read preserve explicit DEX mutes and default-on recipients',async()=>{
 let registry=0,preferences=0;const result=await semanticRecipientPreferences(['admin','pro','free','muted'],'DEX_PAID','DEX_PAID',{
 registry:async key=>{assert.equal(key,'DEX_PAID');registry++;return true;},
 preferences:async(users,keys)=>{preferences++;assert.equal(users.length,4);assert.deepEqual(keys,['DEX_PAID']);return [{telegram_id:'muted',strategy_key:'DEX_PAID',enabled:false}];},
 });assert.equal(registry,1);assert.equal(preferences,1);assert.deepEqual([...result],[['admin',true],['pro',true],['free',true],['muted',false]]);
});
test('global disabled strategy, separate feed mute and opt-in defaults remain authoritative',async()=>{
 const reader={registry:async()=>false,preferences:async()=>[]};
 assert.equal((await semanticRecipientPreferences(['u'],'DEX_PAID','DEX_PAID',reader)).get('u'),false);
 assert.equal((await semanticRecipientPreferences(['u'],null,'X_REPUTED_MENTION',{...reader,registry:async()=>true})).get('u'),false);
 assert.equal((await semanticRecipientPreferences(['u'],'RH_BOOST','other',{registry:async()=>true,preferences:async()=>[{telegram_id:'u',strategy_key:'RH_BOOST',enabled:false}]})).get('u'),false);
});
test('bulk snapshots are bounded to200 users per query and two read workers',async()=>{
 let active=0,peak=0,calls=0;const ids=Array.from({length:450},(_,i)=>String(i));
 const result=await semanticRecipientPreferences(ids,'RH_BOOST',null,{
 registry:async()=>{throw Error('no registry required for feed-only check');},preferences:async users=>{calls++;assert.ok(users.length<=200);active++;peak=Math.max(peak,active);await new Promise(r=>setImmediate(r));active--;return [];},
 });assert.equal(calls,3);assert.equal(peak,2);assert.equal(result.size,450);assert.ok([...result.values()].every(Boolean));
});
test('partial, conflicting or failed snapshot never manufactures permission; caller uses established fallback',async()=>{
 const base={registry:async()=>true,preferences:async()=>[]};
 await assert.rejects(semanticRecipientPreferences(['u'],'DEX_PAID','DEX_PAID',{...base,preferences:async()=>{throw Error('offline');}}),/offline/);
 await assert.rejects(semanticRecipientPreferences(['u'],'DEX_PAID','DEX_PAID',{...base,preferences:async()=>[{telegram_id:'other',strategy_key:'DEX_PAID',enabled:true}]}),/Invalid/);
 await assert.rejects(semanticRecipientPreferences(['u'],'DEX_PAID','DEX_PAID',{...base,preferences:async()=>[{telegram_id:'u',strategy_key:'DEX_PAID',enabled:false},{telegram_id:'u',strategy_key:'DEX_PAID',enabled:true}]}),/Conflicting/);
});
test('events without preference keys require no database queries',async()=>{
 const fail=async()=>{throw Error('unexpected query');};
 assert.equal((await semanticRecipientPreferences(['u'],null,null,{registry:fail,preferences:fail})).get('u'),true);
});
