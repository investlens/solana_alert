import test from 'node:test';import assert from 'node:assert/strict';
import {restoreVolumeHistory} from '../src/services/volumeHistoryCheckpoint.js';
test('volume restart history rejects expired, partial and wrong-day evidence',()=>{
 const now=2000000000000,day=Math.floor(now/86400000),boundary=day*86400000;
 const key='arc:0x'+'1'.repeat(40)+':0x'+'2'.repeat(64)+':'+day;
 const entry={expires:boundary+86400000,window:{dailyAverage:1500,signalVolume:5000,signalMove:2,dayStart:boundary-86400000}};
 assert.equal(restoreVolumeHistory([[key,entry]],now).size,1);
 for(const bad of [{...entry,expires:now},{...entry,window:null},{...entry,window:{...entry.window,dayStart:boundary}},{...entry,window:{...entry.window,signalVolume:NaN}}])assert.equal(restoreVolumeHistory([[key,bad]],now).size,0);
 assert.equal(restoreVolumeHistory([[key+'1',entry]],now).size,0);
});
