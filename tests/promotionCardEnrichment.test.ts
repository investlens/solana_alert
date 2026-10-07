import test from 'node:test';import assert from 'node:assert/strict';
import { schedulePromotionCardEnrichment,promotionContentSignature } from '../src/services/promotionCardEnrichment.js';
const args={kind:'BOOST' as const,text:'old',token:'0x'+'a'.repeat(40),launchType:'PONS',stats:null,securityNote:null,buttons:[]};
test('only accepted IDs are edited, three times at most; failed edit retries without a resend',async()=>{
 const queued:Array<()=>void>=[];const waits:number[]=[];let edits=0,refreshes=0;
 const dep={now:()=>1000000,schedule:(run:()=>void,ms:number)=>{queued.push(run);waits.push(ms);},refresh:async()=>{refreshes++;return{text:'Price $1',buttons:[]};},edit:async()=>{edits++;if(edits===1)throw new Error('network');}};
 assert.equal(schedulePromotionCardEnrichment('retry-test',args,[{chatId:'1',messageId:123}],args.text,dep),true);
 assert.equal(schedulePromotionCardEnrichment('retry-test',args,[{chatId:'1',messageId:123}],args.text,dep),false);
 queued.shift()!();await new Promise(r=>setImmediate(r));queued.shift()!();await new Promise(r=>setImmediate(r));
 queued.shift()!();await new Promise(r=>setImmediate(r));
 assert.deepEqual(waits,[15000,30000,60000]);assert.equal(refreshes,3);assert.equal(edits,2);assert.equal(queued.length,0);
});
test('no accepted message, expiry or timestamp-only changes produce no edits',async()=>{
 const queued:Array<()=>void>=[];let now=0,edits=0;
 const dep={now:()=>now,schedule:(run:()=>void)=>{queued.push(run);},refresh:async()=>({text:'Checked 03:55:00 UTC · 6m ago',buttons:[]}),edit:async()=>{edits++;}};
 assert.equal(schedulePromotionCardEnrichment('empty',args,[{chatId:'1',messageId:0}],'x',dep),false);
 assert.equal(promotionContentSignature('Checked 03:54:00 UTC · 5m ago'),promotionContentSignature('Checked 03:55:00 UTC · 6m ago'));
 schedulePromotionCardEnrichment('clock',args,[{chatId:'1',messageId:123}],'Checked 03:54:00 UTC · 5m ago',dep);
 queued.shift()!();await new Promise(r=>setImmediate(r));now=200000;queued.shift()!();await new Promise(r=>setImmediate(r));assert.equal(edits,0);assert.equal(queued.length,0);
});
