import test from 'node:test';
import assert from 'node:assert/strict';
import { withAlertKeyStats } from '../src/ui/alertKeyStats.js';
test('missing stats are explicit, real zeros survive, and FDV never becomes MC',()=>{
 const card=withAlertKeyStats('<b>BOOST</b>\n<b>FDV</b> $5K\n\n<b>OWNERSHIP</b>\nDev holding Unavailable\nTop 10 Unavailable\n\n<b>CONTRACT</b>\n0x123',{volume5m:0,move1h:0,fdv:5000});
 assert.match(card,/MC <b>Unavailable/);assert.match(card,/Vol · 5m <b>\$0/);assert.match(card,/Move · 1h <b>\+0.00%/);
 assert.match(card,/Total supply <b>Unavailable/);assert.match(card,/Sellability <b>Unverified/);
 assert.equal((card.match(/KEY STATS/g)??[]).length,1);
 assert.equal((withAlertKeyStats(card,{}).match(/KEY STATS/g)??[]).length,1);
});
test('prebond reserve is not fabricated DEX liquidity and project text is escaped',()=>{
 const card=withAlertKeyStats('Alert',{preBond:true,source:'<bad>',checkedAt:'01:00:00',sellability:'Trusted PONS route'});
 assert.match(card,/Bonding curve · no DEX LP/);assert.match(card,/&lt;bad&gt;/);assert.match(card,/Validate the contract/);
});
test('long age and supply are compact and equal FDV is not duplicated',()=>{
 const card=withAlertKeyStats('Alert',{marketCap:11980,fdv:11980,pairCreatedAt:Date.now()-1266*60000,supply:'998,724,442.2'});
 assert.match(card,/21h 6m/);assert.match(card,/998.72M/);assert.doesNotMatch(card,/FDV/);
});
test('pending PONS venue is compact, retains supply and ownership, and removes untrusted market figures',()=>{
 const card=withAlertKeyStats('<b>BOOST DETECTED</b>\nPrice $0.1\nMC $100K\nLiquidity $9K\n\n<b>OWNERSHIP</b>\nDev holding <b>10%</b>\nTop 10 <b>Unavailable</b>\n\n<b>CONTRACT</b>\n<code>0x123</code>',{
  authoritativeVenue:true,source:'PONS venue data pending',supply:'1000000000',sellability:'Trusted PONS route',
 });
 assert.match(card,/Market data <b>Pending venue confirmation/);
 assert.match(card,/Total supply <b>1B/);
 assert.match(card,/Dev holding <b>10%/);
 assert.match(card,/Top 10 <b>Unavailable/);
 assert.match(card,/Sellability <b>Trusted PONS route/);
 assert.doesNotMatch(card,/\$0\.1|\$100K|\$9K|Vol · 5m|Move · 1h|Pair age/);
 assert.match(card,/not confirmed/);
});
