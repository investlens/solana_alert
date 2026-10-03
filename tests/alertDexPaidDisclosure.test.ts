import test from 'node:test';
import assert from 'node:assert/strict';
import {createAlertDexPaidReader,decorateDexPaidAlert} from '../src/services/alertDexPaidDisclosure.js';
const token='0x'+'a'.repeat(40);
const result=(dexPaid:boolean|null)=>({tokenAddress:token,dexPaid,status:dexPaid===true?'PAID' as const:dexPaid===false?'NOT_PAID' as const:'UNKNOWN' as const,orderTypes:[],orderStatuses:[],latestPaymentTimestamp:null,warnings:[],scannedAt:0});
test('paid disclosure retains PONS and adds one token-specific DexScreener button in two-column rows',()=>{
 const buttons=[[{text:'PONS',url:`https://www.ponsfamily.com/launchpad/${token}`},{text:'Intel',callback_data:'FI'}],[{text:'Track',callback_data:'TRACK'},{text:'Copy',callback_data:'COPY'}]];
 const card=decorateDexPaidAlert('Token\n<b>CONTRACT</b>\n<code>'+token+'</code>',buttons,token,'PAID');
 assert.match(card.text,/Dex Paid<\/b>  Yes/);assert.ok(card.buttons.every(row=>row.length<=2));
 assert.equal(card.buttons.flat().filter(b=>b.url?.includes('dexscreener.com')).length,1);
 assert.ok(card.buttons.flat().some(b=>b.url?.includes('ponsfamily.com')));
 assert.equal(buttons.flat().length,4);
 const repeated=decorateDexPaidAlert(card.text,card.buttons,token,'PAID');
 assert.equal(repeated.text,card.text);assert.equal(repeated.buttons.flat().length,5);
});
test('unknown is not reported as unpaid and existing chart is reused without a duplicate button',()=>{
 assert.match(decorateDexPaidAlert('Token',[],token,'UNKNOWN').text,/Unavailable/);
 assert.match(decorateDexPaidAlert('Token',[],token,'NOT_PAID').text,/No paid order reported/);
 const card=decorateDexPaidAlert('Token',[[{text:'Chart',url:`https://dexscreener.com/robinhood/${token}`}]],token,'PAID');
 assert.equal(card.buttons.flat().length,1);assert.equal(card.buttons[0][0].text,'💎 DexScreener');
 assert.equal(decorateDexPaidAlert('Token',[],'bad','PAID').buttons.length,0);
});
test('recipient lookups coalesce and an unavailable provider never becomes a negative paid claim',async()=>{
 let calls=0;let at=100000;
 const read=createAlertDexPaidReader(async()=>{calls++;return result(null);},()=>at);
 assert.deepEqual(await Promise.all([read(token),read(token)]),['UNKNOWN','UNKNOWN']);assert.equal(calls,1);
 await read(token);assert.equal(calls,1);
 at+=15001;await read(token);assert.equal(calls,2);
});
test('lookup budget caps provider calls and resets after a minute',async()=>{
 let calls=0;let at=100000;
 const read=createAlertDexPaidReader(async()=>{calls++;return result(false);},()=>at);
 for(let i=1;i<=11;i++) await read('0x'+i.toString(16).padStart(40,'0'));
 assert.equal(calls,10);assert.equal(await read('0x'+(11).toString(16).padStart(40,'0')),'UNKNOWN');
 at+=60001;assert.equal(await read('0x'+(11).toString(16).padStart(40,'0')),'NOT_PAID');assert.equal(calls,11);
});
