import test from 'node:test';import assert from 'node:assert/strict';
import { buildPromotionEventCard } from '../src/ui/promotionEventCard.js';
const token='0x'+'a'.repeat(40);
test('Boost retains event facts, honest venue, ownership warnings and common four controls',()=>{
 const c=buildPromotionEventCard({kind:'BOOST',token,launchType:'PONS',stats:{name:'MochiOracle',symbol:'MOCHI',source:'PONS venue data pending'},securityNote:null,buttons:[],text:'🚀 BOOST DETECTED\n⚡ <b>Boost</b> 30 total (+30)\nDex Paid Yes\nDev holding <b>10.00%</b>\nTop 10 <b>Unavailable</b>\n⚠️ Concentrated dev holding · potential sell pressure'});
 assert.match(c.text,/30 total \(\+30\)/);assert.match(c.text,/Dex Paid Yes/);assert.match(c.text,/Trading venue unconfirmed/);assert.doesNotMatch(c.text,/no confirmed DEX pair|LP lock status/);assert.match(c.text,/10.00%/);assert.match(c.text,/Concentrated dev/);
 assert.equal(c.buttons.flat().length,4);assert.equal(c.buttons[0][0].text,'🚀 PONS');assert.match(c.buttons[0][1].text,/Full Intel/);assert.match(c.buttons[1][0].text,/Track/);
});
test('venue uncertainty does not imply prebond; custom critical warnings remain',()=>{
 const c=buildPromotionEventCard({kind:'BOOST',token,launchType:'CUSTOM',stats:{name:'A<&',symbol:'A',price:0.1},securityNote:'⚠️ LP UNLOCKED: liquidity can be pulled.',buttons:[[{text:'DexScreener',url:'https://dexscreener.com/robinhood/'+token}]],text:'Boost 10 total (+10)\nPrice $0.1'});
 assert.match(c.text,/A&lt;&amp;/);assert.match(c.text,/LP UNLOCKED/);assert.doesNotMatch(c.text,/Bonding curve/);assert.equal(c.buttons.flat().some(b=>b.url?.includes('dexscreener')),false);
});
test('linked producer identity survives absent public metadata and later compact re-render',()=>{
 const args={kind:'BOOST' as const,token,launchType:'PONS',stats:null,securityNote:null,buttons:[],text:'🚀 BOOST DETECTED\n<a href="https://dexscreener.com/robinhood/'+token+'"><b>$MOCHI</b></a> · MochiOracle\nBoost 30 total (+30)'};
 const first=buildPromotionEventCard(args);assert.match(first.text,/MochiOracle \(\$MOCHI\)/);
 const next=buildPromotionEventCard({...args,text:first.text});assert.match(next.text,/MochiOracle \(\$MOCHI\)/);assert.doesNotMatch(next.text,/Token identity pending/);
});
