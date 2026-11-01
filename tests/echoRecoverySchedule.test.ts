import test from 'node:test';
import assert from 'node:assert/strict';
import {planEchoRecovery,ECHO_ARCHIVE_AUDIT_INTERVAL_MS,ECHO_HEAD_SPOTCHECK_INTERVAL_MS,
 ECHO_DISCONNECTED_CATCHUP_INTERVAL_MS} from '../src/echo/recoverySchedule.js';
const now=1800000000000;
const base={nowMs:now,websocketReady:true,queueSize:0,historyPending:true,
 lastArchiveAtMs:now-60_000,lastHeadAtMs:now-60_000};
test('connected WebSocket with unfinished old checkpoint causes zero minute-by-minute wallet polls',()=>{
 for(let minute=1;minute<15;minute++){
  const d=planEchoRecovery({...base,nowMs:now+minute*60_000,
   lastArchiveAtMs:now,lastHeadAtMs:now});
  assert.deepEqual(d,{mode:'none',reason:'NOT_DUE'});
 }
});
test('bounded head spot-check at 15m never implies complete historical coverage',()=>{
 const d=planEchoRecovery({...base,nowMs:now+ECHO_HEAD_SPOTCHECK_INTERVAL_MS,
  lastArchiveAtMs:now,lastHeadAtMs:now});
 assert.deepEqual(d,{mode:'head',reason:'LIVE_HEAD_SPOT_CHECK'});
});
test('old history gets an archive audit only after a long interval, not every minute',()=>{
 const d=planEchoRecovery({...base,nowMs:now+ECHO_ARCHIVE_AUDIT_INTERVAL_MS,
  lastArchiveAtMs:now,lastHeadAtMs:now+ECHO_HEAD_SPOTCHECK_INTERVAL_MS});
 assert.deepEqual(d,{mode:'archive',reason:'ARCHIVE_AUDIT_DUE'});
});
test('reconnected WebSocket gets immediate bounded recovery unless just audited',()=>{
 assert.deepEqual(planEchoRecovery({...base,lastArchiveAtMs:null,reconnectEvent:true}),
  {mode:'archive',reason:'WS_RECONNECTED'});
 assert.deepEqual(planEchoRecovery({...base,reconnectEvent:true}),
  {mode:'none',reason:'NOT_DUE'});
});
test('disconnected stream triggers bounded recovery every three minutes',()=>{
 const d=planEchoRecovery({...base,websocketReady:false,
  lastArchiveAtMs:now-ECHO_DISCONNECTED_CATCHUP_INTERVAL_MS});
 assert.deepEqual(d,{mode:'archive',reason:'WS_DISCONNECTED'});
});
test('live queue pressure suppresses any historical activity, even on reconnect',()=>{
 const d=planEchoRecovery({...base,queueSize:16,lastArchiveAtMs:null,reconnectEvent:true});
 assert.deepEqual(d,{mode:'none',reason:'LIVE_QUEUE_PRESSURE'});
});
test('bad clock, future audit marker and negative queues fail closed',()=>{
 assert.throws(()=>planEchoRecovery({...base,queueSize:-1}),/INVALID_RECOVERY_CLOCK_OR_QUEUE/);
 assert.throws(()=>planEchoRecovery({...base,lastHeadAtMs:now+1}),/INVALID_RECOVERY_CLOCK_OR_QUEUE/);
});

test('healthy incoming WS notifications suppress wasteful signature head polling',()=>{
 const result=planEchoRecovery({...base,nowMs:now+ECHO_HEAD_SPOTCHECK_INTERVAL_MS,
  lastArchiveAtMs:now,lastHeadAtMs:now,
  lastStreamNotificationAtMs:now+ECHO_HEAD_SPOTCHECK_INTERVAL_MS-1000});
 assert.deepEqual(result,{mode:'none',reason:'NOT_DUE'});
});
test('stale WS notification permits bounded spot-check even without archive debt',()=>{
 const result=planEchoRecovery({...base,historyPending:false,
  nowMs:now+ECHO_HEAD_SPOTCHECK_INTERVAL_MS,
  lastArchiveAtMs:now,lastHeadAtMs:now,lastStreamNotificationAtMs:now});
 assert.deepEqual(result,{mode:'head',reason:'LIVE_HEAD_SPOT_CHECK'});
});
