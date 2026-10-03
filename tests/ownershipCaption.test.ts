import test from 'node:test';
import assert from 'node:assert/strict';
import {telegramCaptionLength} from '../src/ui/alphaosPhotoDelivery.js';
test('formatted ownership captions keep their banner within the visible Telegram limit',()=>{
 const text='<b>'+ 'A'.repeat(1010)+'</b> &amp; &#x1F600;';
 assert.ok(text.length>1024);assert.equal(telegramCaptionLength(text),1015);
});
