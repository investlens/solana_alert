import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTradeSetupCard, tradeSetupDeliveryFlags } from '../src/ui/tradeSetupCard.js';
import { withAlertKeyStats } from '../src/ui/alertKeyStats.js';
import { cleanAlertCard } from '../src/ui/alertCardLayout.js';
import {telegramCaptionLength} from '../src/ui/alphaosPhotoDelivery.js';

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
 assert.match(card,/DEX activity.*Unavailable/);assert.doesNotMatch(card,/Vol · 5m/);
 assert.ok(card.indexOf('$8.13K')<card.indexOf('WHY WATCHING'));
 assert.match(card,/Unverified/);assert.match(card,/0.95%/);assert.match(card,/Top 10.*Unavailable/);
 assert.equal(cleanTradeSetupCard('BOOST DETECTED'), 'BOOST DETECTED');
});
test('confirmation prose cannot suppress a verified price field',()=>{
 const text=withAlertKeyStats('Confirmation Two spaced reserve/price increases',{price:0.00001});
 assert.match(text,/Price <b>\$0.000010000<\/b>/);
});
test('screenshot-style setup becomes concise without hiding execution or LP risk',()=>{
 const input=['🎯 <b>AlphaOS · TRADE SETUP WATCH</b>','<b>MAC</b> · Multi Agent Controller','PONS · Robinchain · Pre-bond',
 'Price <b>$0.000022005</b>','MC <b>$22.01K</b>','Launch age <b>54m</b>','Recovery from observed low <b>+170.2%</b>',
 'Creator transfers <b>None in scanned evidence</b>','Curve quote reserve <b>3.7609 ETH</b>',
 'Reserve is not a size-specific sell quote.','Exit quote / slippage <b>Not verified</b>',
 'Observed low / invalidation reference <b>0.0000000311641 ETH/token</b>',
 'Entry, position size and exit require your own execution check.',
 'Vol · 5m <b>$647.11</b>','Trades · 5m <b>10 buy / 4 sell</b>','Dev holding <b>1.70%</b>',
 'Top 10 · indexed sample <b>25.24%</b>','Dev observed 23:56:41 UTC · on-chain block 86234826',
 'Holder sample observed 23:56:47 UTC','<b>Dex Paid</b> No paid order reported',
 'LP lock: <b>Unverified</b>','RISKY ALERT — LIQUIDITY PROTECTION UNVERIFIED.',
 '<code>0x'+'a'.repeat(40)+'</code>','Evidence checked 23:56:41 UTC',
 '<i>Research setup · Social ownership unverified · DYOR</i>',
 '<i>Validate the contract, ownership and liquidity before investing.</i>'].join('\n');
 const card=cleanAlertCard(cleanTradeSetupCard(input));
 assert.ok(telegramCaptionLength(card)<1200);
 for(const value of ['170.2%','3.7609 ETH','$647.11','10 buy / 4 sell','1.70%','25.24%','Unconfirmed','Unverified','LIQUIDITY PROTECTION UNVERIFIED','0.0000000311641'])assert.ok(card.includes(value),value);
 assert.doesNotMatch(card,/Dev observed|Holder sample observed|Reserve is not|Validate the contract/);
 assert.equal((card.match(/23:56:41/g)??[]).length,1);
});
