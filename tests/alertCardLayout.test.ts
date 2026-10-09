import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanAlertCard, cleanAlertButtons} from '../src/ui/alertCardLayout.js';
const ca='0x1234567890abcdef1234567890abcdef12345678';
test('all alert families retain stats, unknowns and risk evidence with compact sections',()=>{
 for(const title of ['BOOST DETECTED','DEX PAID DETECTED','SOCIAL MAFIA ALERT','PROTOCOL DISCOVERY','TRADE SETUP WATCH','PONS TREND','ARC OPPORTUNITY','SUPPLY BURN','DEV SELL','MONITOR UPDATE','CONTRACT SCREEN','CREATOR INTEL']) {
 const input=`<b>ALPHAOS · ${title}</b>\n$TOKEN\n\n\n<b>STATS</b>\nPrice <b>$0.01</b>\n⚡ <b>Boost</b> 10 total (+10)\n\n\n<b>RISK</b>\n⚠️ LP unlocked · HIGH RUG RISK\n\n<b>KEY STATS</b>\nVol · 24h <b>$45K</b>\nTotal supply <b>Unavailable</b>\nSellability <b>Verified flags · not a guarantee</b>\n\n<b>OWNERSHIP</b>\nDev holding <b>10%</b>\nTop 10 · indexed sample <b>25%</b>\n\n<b>Dex Paid</b> Yes\n\n<b>CONTRACT</b>\n<code>${ca}</code>\nSource DEXScreener · Checked 06:15:00 UTC`;
 const out=cleanAlertCard(input);
 assert.doesNotMatch(out,/\n{3,}/);
 assert.doesNotMatch(out,/KEY STATS/);
 assert.equal((out.match(/<b>STATS<\/b>/g)||[]).length,1);
 for(const evidence of ['HIGH RUG RISK','$45K','Unavailable','not a guarantee','10%','25%',ca,'06:15:00 UTC'])assert.ok(out.includes(evidence),title+': '+evidence);
 assert.ok(out.indexOf('Dex Paid')<out.indexOf('<b>STATS</b>'));
 assert.equal(cleanAlertCard(out),out,'edits should not duplicate/reorder blocks');
 }
});
test('button cleanup preserves every distinct action, orders and callbacks',()=>{
 const buttons=[[{text:'Chart',url:'https://dexscreener.com/arc/pair'},{text:'Full Intel',callback_data:'FI_ARC_'+ca},{text:'Track',callback_data:'TRACK_'+ca}],[],[{text:'Chart duplicate',url:'https://dexscreener.com/arc/pair'},{text:'Copy CA',callback_data:'COPY_'+ca},{text:'X',url:'https://x.com/project'}]];
 const out=cleanAlertButtons(buttons)!;
 assert.deepEqual(out.map(r=>r.length),[2,2,1]);
 assert.deepEqual(out.flat().map(b=>b.callback_data||b.url),['https://dexscreener.com/arc/pair','FI_ARC_'+ca,'TRACK_'+ca,'COPY_'+ca,'https://x.com/project']);
});
test('menu content is preserved apart from excessive blank lines',()=>{
 const text='<b>SETTINGS</b>\n\nChoose your alerts';assert.equal(cleanAlertCard(text),text);
});

test('empty legacy stats cannot swallow risk; supplemental numbers precede risk',()=>{
 const out=cleanAlertCard(`<b>BOOST DETECTED</b>\n<b>STATS</b>\n<b>RISK</b>\nVerified PONS origin\n\n<b>KEY STATS</b>\nPrice <b>$0.01</b>\nLP lock status <b>Not independently checked</b>\nSource DEXScreener · PONS-mapped graduated pool · Checked 13:07:00 UTC\n\n<b>CONTRACT</b>\n<code>${ca}</code>`);
 assert.ok(out.indexOf('Price')<out.indexOf('<b>RISK</b>'));
 assert.ok(out.indexOf('LP lock status')>out.indexOf('<b>RISK</b>'));
 assert.ok(out.indexOf('DEXScreener')>out.indexOf(ca));
 assert.equal(cleanAlertCard(out),out);
});
test('inline social retains destination while redundant button disappears',()=>{
 const url='https://x.com/Drawdown';
 const text=cleanAlertCard(`<b>BOOST DETECTED</b>\n<a href="${url}">X</a>\n<code>${ca}</code>`);
 assert.ok(text.includes('@Drawdown'));
 assert.deepEqual(cleanAlertButtons([[{text:'X',url},{text:'Track',callback_data:'T'}]],text),[[{text:'Track',callback_data:'T'}]]);
 assert.equal(cleanAlertButtons([[{text:'X',url}]],'')!.flat().length,1);
});

test('paid and prebond actions retain PONS and social links after four primary controls',()=>{
 const rows=[[{text:'PONS',url:'https://www.ponsfamily.com/launchpad/token'},{text:'DexScreener',url:'https://dexscreener.com/robinhood/token'}],[{text:'Full Intel',callback_data:'FI'},{text:'Track',callback_data:'TRACK'}],[{text:'Copy CA',callback_data:'COPY'},{text:'TG',url:'https://t.me/project'}]];
 assert.deepEqual(cleanAlertButtons(rows)!.map(row=>row.map(b=>b.text)),[['PONS','Full Intel'],['Track','Copy CA'],['DexScreener','TG']]);
});
