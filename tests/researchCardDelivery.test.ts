import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverResearchCard,researchErrorSummary} from '../src/bot/researchCardDelivery.js';
test('long research captions and unavailable banners still deliver useful text',async()=>{
 for(const [caption,image] of [['A'.repeat(1025),Buffer.from('png')],['Research · Safety not assessed',null]] as const){
  let text='';await deliverResearchCard({reply:async(t:string)=>{text=t;},replyWithPhoto:async()=>{throw new Error('Photo should not be used');}}, {caption,image,keyboard:{inline_keyboard:[]},refresh:false});
  assert.equal(text,caption);
 }
});
test('explicit image rejection falls back once; ambiguous failures never retry',async()=>{
 let sends=0;const args={caption:'Research',image:Buffer.from('png'),keyboard:{},refresh:false};
 await deliverResearchCard({reply:async()=>{sends++;},replyWithPhoto:async()=>{throw {response:{error_code:400,description:'Bad Request: IMAGE_PROCESS_FAILED'}};}},args);
 assert.equal(sends,1);
 await assert.rejects(deliverResearchCard({reply:async()=>{sends++;},replyWithPhoto:async()=>{throw new Error('timeout');}},args));
 assert.equal(sends,1);
});
test('refreshing a text fallback edits that report instead of attempting media',async()=>{
 let edits=0;await deliverResearchCard({callbackQuery:{message:{text:'old'}},editMessageText:async()=>{edits++;}}, {caption:'Research',image:null,keyboard:{},refresh:true});assert.equal(edits,1);
 assert.doesNotMatch(researchErrorSummary(new Error('123456:abcdefghijklmnopqrstuvxyz')),/123456/);
});
