import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDexPaidEventCard } from '../src/ui/dexPaidCard.js';
import { ponsVenueStats } from '../src/services/ponsAlertVenue.js';
const token='0x'+'a'.repeat(40);
const legacy='💎 DEX PAID DETECTED\n\n<b>KEY STATS</b>\nPrice <b>Unavailable</b>\nMC <b>Unavailable</b>\n\n<b>OWNERSHIP</b>\n👨‍💻 Dev holding <b>0.00%</b>\n👥 Top 10 <b>Unavailable</b>\nCreator wallet balance only · sale, transfer or burn not established\n\nALPHAOS VERDICT: PROMOTION EVENT\nVerified payment detected\nPaid promotion does not establish trading quality.';
test('pending PONS payment is compact, uses available identity, full CA and no invented DEX URL',()=>{
 const card=buildDexPaidEventCard({text:legacy,token,launchType:'PONS',stats:{name:'FreeRoll',symbol:'ROLL',authoritativeVenue:true,source:'PONS venue data pending'},securityNote:null,
 buttons:[[{text:'DexScreener',url:`https://dexscreener.com/robinhood/${token}`},{text:'Copy CA',callback_data:'COPY_CA_'+token}]]});
 assert.match(card.text,/FreeRoll \(\$ROLL\)/);assert.match(card.text,/0\.00%/);assert.match(card.text,/does not prove a sale or burn/);
 assert.ok(card.text.includes(`<code>${token}</code>`));assert.ok(card.text.length<1000);
 assert.doesNotMatch(card.text,/ALPHAOS VERDICT|ACTION: WATCH|LP lock status/);
 assert.equal(card.buttons.flat().some(b=>b.url?.includes('dexscreener')),false);
 assert.equal(card.buttons.flat().filter(b=>b.url?.includes('ponsfamily')).length,1);
 assert.ok(card.buttons.every(row=>row.length<=2));
});
test('confirmed exact-pool card retains real zero metrics, risk and ownership warnings',()=>{
 const pool='0x'+'b'.repeat(40),url=`https://dexscreener.com/robinhood/${pool}`;
 const card=buildDexPaidEventCard({text:'💵 <b>Price</b> $0.01\nMC <b>$10K</b>\nVol · 5m <b>$0</b>\nDev holding <b>10.00%</b>\nTop 10 <b>40.00%</b>\n⚠️ Concentrated dev holding · potential sell pressure',token,launchType:'CUSTOM',stats:{name:'A<&',symbol:'A',chartUrl:url},securityNote:'⚠️ LP unlocked · liquidity can be removed.',buttons:[]});
 assert.match(card.text,/A&lt;&amp;/);assert.match(card.text,/\$0\.01/);assert.match(card.text,/Vol · 5m <b>\$0/);assert.match(card.text,/Concentrated dev/);assert.match(card.text,/LP unlocked/);
 assert.equal(card.buttons.flat()[0].url,url);
});
test('pending venue retains PONS identity and socials without inventing a market quote',()=>{
 const context={name:'FreeRoll',symbol:'ROLL',creator:token,decimals:18,totalSupplyRaw:1000n,twitter:'https://x.com/playyfreeroll',telegram:null,fdvUsd:10,priceUsd:0.01};
 const stats=ponsVenueStats(token,context,null,[]);
 assert.equal(stats.name,'FreeRoll');assert.equal(stats.symbol,'ROLL');assert.equal(stats.twitter,context.twitter);
 assert.equal(stats.price,undefined);assert.equal(stats.chartUrl,undefined);
});
