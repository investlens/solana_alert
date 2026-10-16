import test from 'node:test';
import assert from 'node:assert/strict';
import {runDatabaseWork,withDatabaseRequestPriority,currentDatabaseWorkClass,resetDatabaseGovernorForTests} from '../src/services/databaseLoadGovernor.js';

process.env.SUPABASE_URL='https://priority-test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test';
process.env.SUPABASE_BACKGROUND_CONCURRENCY='1';
process.env.SUPABASE_CRITICAL_CONCURRENCY='1';
process.env.TESTING_REALTIME_ALERTS='true';

test('analytics requests cannot occupy the subscriber preference lane; paid labels remain authentic',async()=>{
  resetDatabaseGovernorForTests();
  const original=globalThis.fetch;
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  let began!:()=>void;const started=new Promise<void>(resolve=>{began=resolve;});
  const calls:string[]=[];
  globalThis.fetch=async(input)=>{
    const path=new URL(String(input)).pathname;calls.push(path);
    if(path.endsWith('/opportunities')) {began();await held;}
    return new Response(JSON.stringify(path.endsWith('/users')?[{telegram_id:'test',tier:'free',subscription_status:'none',is_blocked:false}]:[]),{status:200,headers:{'content-type':'application/json'}});
  };
  try {
    const {supabase}=await import('../src/services/supabase.js');
    const analytics=runDatabaseWork('BACKGROUND',async()=>{
      assert.equal(currentDatabaseWorkClass(),'BACKGROUND');
      return Promise.all([supabase.from('opportunities').select('id'),supabase.from('alpha_alert_events').select('id')]);
    });
    await started;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      const result=await Promise.race([
        supabase.from('user_strategy_preferences').select('enabled'),
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Preferences blocked behind analytics')),500);}),
      ]);
      assert.equal(result.error,null);
      assert.equal(calls.includes('/rest/v1/alpha_alert_events'),false,'second analytics read stays in bounded background queue');
      const users=await supabase.from('users').select('*').eq('is_blocked',false);
      assert.equal(users.data?.[0].tier,'free','realtime mode must not falsify audit tier');
    } finally {if(timer)clearTimeout(timer);release();await analytics;}
    assert.equal(currentDatabaseWorkClass(),undefined);
    assert.equal(calls.includes('/rest/v1/alpha_alert_events'),true);
  } finally {release();globalThis.fetch=original;}
});


test('scheduled scanner refresh retains transport priority even while optional analytics owns admission',async()=>{
  resetDatabaseGovernorForTests();let release!:()=>void;
  const held=runDatabaseWork('BACKGROUND',()=>new Promise<void>(resolve=>{release=resolve;}));
  try {
    assert.equal(await runDatabaseWork('BACKGROUND',async()=>true),null);
    assert.equal(await withDatabaseRequestPriority('BACKGROUND',async()=>{
      assert.equal(currentDatabaseWorkClass(),'BACKGROUND');return 'refreshed';
    }),'refreshed');
    assert.equal(currentDatabaseWorkClass(),undefined);
  } finally {release();await held;}
});
