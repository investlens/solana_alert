import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTradeSetupCard, tradeSetupDeliveryFlags } from '../src/ui/tradeSetupCard.js';
import { withAlertKeyStats } from '../src/ui/alertKeyStats.js';
import { cleanAlertCard } from '../src/ui/alertCardLayout.js';

test('setup routing selects venue without disabling setup controls',()=>{
 assert.deepEqual(tradeSetupDeliveryFlags('DEX'),{preBond:false,setupControls:true});
 assert.deepEqual(tradeSetupDeliveryFlags('CURVE'),{preBond:true,setupControls:true});
});
test('setup compacts unavailable windows, preserves risk and prioritises valuation',()=>{
 const text=['🎯 <b>AlphaOS · TRADE SETUP WATCH</b>','INTELIO · INTELIO','PONS · Robinchain · Pre-bond','',
 '<b>CONFIRMED EVIDENCE</b>','Confirmation Two consecutive spaced reserve/price increases','Recovery from observed low +5.9%',
 '<b>KEY STATS</b>','MC <b>Unavailable</b>','FDV <b>$8.13K</b>','Vol · 5m <b>Unavailable</b>','Move · 1h <b>Unavailable</b>',
 'DEX Paid <b>Unavailable</b>','<b>Dex Paid</b> No paid order reported','Exit quote / slippage <b>Not verified</b>',
 '<b>OWNERSHIP</b>','Dev holding <b>0.95%</b>','Top 10 <b>Unavailable</b>','<code>0x'+'1'.repeat(40)+'</code>'].join('\n');
 const card=cleanAlertCard(cleanTradeSetupCard(text));
 assert.equal((card.match(/DEX Paid|Dex Paid/g)??[]).length,1);
 assert.match(card,/No paid order reported/);assert.doesNotMatch(card,/WHY ALERTED/);
 assert.match(card,/DEX activity windows.*Unavailable/);assert.doesNotMatch(card,/Vol · 5m/);
 assert.ok(card.indexOf('$8.13K')<card.indexOf('WHY WATCHING'));
 assert.match(card,/Not verified/);assert.match(card,/0.95%/);assert.match(card,/Top 10.*Unavailable/);
 assert.equal(cleanTradeSetupCard('BOOST DETECTED'), 'BOOST DETECTED');
});
test('confirmation prose cannot suppress a verified price field',()=>{
 const text=withAlertKeyStats('Confirmation Two spaced reserve/price increases',{price:0.00001});
 assert.match(text,/Price <b>\$0.000010000<\/b>/);
});
