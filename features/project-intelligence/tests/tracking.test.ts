import test from 'node:test';import assert from 'node:assert/strict';
import {createTracking,ResearchService,materialChanges,type StateStore,type TrackState} from '../service.js';import type {Report} from '../model.js';
const token='0x'+'a'.repeat(40),dev='0x'+'b'.repeat(40);
function report(time:number,value='100',quality='VERIFIED',owner=dev):Report{return {version:1,chain:'robinhood',token,generatedAt:new Date(time).toISOString(),block:'0x10',coverage:{} as any,limits:[],findings:[{id:'developer-holding',section:'developer',quality:quality as any,severity:'INFO',subject:dev,value,summary:'holding',evidence:[]},{id:'owner',section:'controls',quality:'VERIFIED',severity:'INFO',subject:owner,summary:'owner',evidence:[]}]};}
test('tracking changes never call a balance decrease a sale, or turn unavailable data into a loss event',()=>{
 const before=report(1000000),after=report(1000001,'50');assert.match(materialChanges(before,after)[0],/does not establish a sale/);
 assert.deepEqual(materialChanges(before,report(1000001,'0','UNVERIFIED')),[]);
 assert.deepEqual(materialChanges(before,{...after,chain:'arc'}),[]);
 assert.match(materialChanges(before,report(1000001,'100','VERIFIED','0x'+'c'.repeat(40)))[0],/owner address changed/);
});
test('tracking is opt-in, scoped per member and protects ambiguous sends against replay',async()=>{
 let now=1000000,pro=true,sends=0;const state:TrackState={tracks:[],notices:[]};
 const store:StateStore={read:async()=>structuredClone(state),mutate:async fn=>fn(state)};
 const service=new ResearchService({now:()=>now,member:async id=>({telegram_id:id,tier:pro?'admin':'free'}),build:async()=>report(now,now===1000000?'100':'50')});
 const tracking=createTracking({store,service,now:()=>now,send:async()=>{sends++;throw Error('ambiguous network');}});
 const id=await tracking.start('1','robinhood',token);assert.equal((await tracking.list('2')).length,0);
 await tracking.stop('2',id);assert.equal(state.tracks.length,1);
 now+=300001;await tracking.tick();assert.equal(sends,1);assert.equal(state.notices[0].state,'HELD');
 now+=300001;await tracking.tick();assert.equal(sends,1);
 pro=false;await assert.rejects(tracking.start('1','robinhood',token),/Pro/);await tracking.tick();assert.equal(sends,1);
});
test('failed research tracks back off without starving other due tracks or creating notifications',async()=>{
 let now=1000000;const attempted:string[]=[];
 const tracks=['1','2','3'].map(user=>({id:user,user,chain:'robinhood' as const,token,expires:now+86400000,next:now,baseline:report(now-1000),last:report(now-1000)}));
 const state:TrackState={tracks,notices:[]},store:StateStore={read:async()=>structuredClone(state),mutate:async fn=>fn(state)};
 const service=new ResearchService({now:()=>now,member:async id=>{attempted.push(id);throw Error('Membership temporarily unavailable');},build:async()=>report(now)});
 const tracking=createTracking({store,service,now:()=>now,send:async()=>{throw Error('Must not send');}});
 await tracking.tick();assert.deepEqual(attempted,['1','2']);assert.equal(state.tracks[0].next,now+300000);assert.equal(state.tracks[0].last.generatedAt,report(now-1000).generatedAt);
 await tracking.tick();assert.deepEqual(attempted,['1','2','3']);assert.equal(state.notices.length,0);
});
