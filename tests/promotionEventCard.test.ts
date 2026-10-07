import test from 'node:test';import assert from 'node:assert/strict';
import { buildPromotionEventCard } from '../src/ui/promotionEventCard.js';
const token='0x'+'a'.repeat(40);
test('Boost and DEX cards retain creator links with unknown holdings and deduplicate identity',()=>{
 const creator='0x'+'b'.repeat(40);
 for(const kind of ['BOOST','DEX_PAID'] as const){
  const card=buildPromotionEventCard({kind,token,launchType:'PONS',stats:{creator},securityNote:null,buttons:[],text:`Creator <a href="https://robinhoodchain.blockscout.com/address/${creator}">creator</a>\nDev holding <b>Unavailable</b>`});
  assert.match(card.text,new RegExp('address/'+creator));assert.equal((card.text.match(/Creator <a/g)??[]).length,1);assert.match(card.text,/Dev holding <b>Unavailable/);
  const fallback=buildPromotionEventCard({kind,token,launchType:'PONS',stats:null,securityNote:null,buttons:[],text:card.text});assert.match(fallback.text,new RegExp('address/'+creator));
 }
});
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

test('required market cap remains visible beside FDV and missing stats are disclosed compactly',()=>{
 const card=buildPromotionEventCard({kind:'DEX_PAID',token,launchType:'PONS',stats:{name:'orynt.fun',symbol:'ORYNT',fdv:21030},securityNote:null,buttons:[],text:'Price <b>$0.000021026</b>\nFDV <b>$21.03K</b>\nTotal supply <b>1B</b>'});
 assert.match(card.text,/Market cap <b>Unavailable<\/b>/);assert.match(card.text,/FDV shown; circulating supply unconfirmed/);
 assert.match(card.text,/Market data incomplete · use Full Intel to recheck/);
 assert.match(card.text,/FDV <b>\$21.03K/);
});

test('Social Mafia card keeps identity evidence, key market stats and ownership without promotion wording',()=>{
 const card=buildPromotionEventCard({kind:'SOCIAL_MAFIA',token,launchType:'PONS',stats:{name:'Project',symbol:'PRO'},securityNote:null,buttons:[],text:'Contract evidence <b>Cross-linked Website</b>\nEvidence <a href="https://project.example/">View acknowledgement</a>\nPrice $0.01\nMC $100K\nLiquidity $12K\nVol · 5m $2K\nMove · 1h +8%\nDev holding 3%\nTop 10 28%'});
 assert.match(card.text,/SOCIAL MAFIA/);assert.match(card.text,/Cross-linked Website/);assert.match(card.text,/https:\/\/project.example/);assert.match(card.text,/MC \$100K/);assert.match(card.text,/Top 10 28%/);assert.doesNotMatch(card.text,/Boost purchase|Payment|Promotion event/);
});

test('combined legacy rows render once with market cap first and no false missing notices',()=>{
 const card=buildPromotionEventCard({kind:'DEX_PAID',token,launchType:'UNKNOWN',stats:{price:0.0001424,marketCap:142500,liquidity:58500,volume5m:59200,volume24h:110350,pairCreatedAt:Date.now()-19*60000,supply:'1000000000'},securityNote:null,buttons:[],text:'Vol · 24h $110.35K\n💰 Price <b>$0.0001424</b> · Market cap <b>$142.5K</b>\n💧 Liquidity <b>$58.5K</b> · 📊 5m volume <b>$59.2K</b>'});
 assert.match(card.text,/<b>MARKET<\/b>\nMC <b>\$142.5K<\/b>\nPrice/);
 assert.equal((card.text.match(/142.5K/g)??[]).length,1);
 assert.match(card.text,/Vol · 5m <b>\$59.2K/);assert.match(card.text,/Pair age <b>19m/);
 assert.doesNotMatch(card.text,/Market cap <b>Unavailable|Not reported:.*5m volume/);
 const legacy=buildPromotionEventCard({kind:'DEX_PAID',token,launchType:null,stats:null,securityNote:null,buttons:[],text:'💰 Price $0.1 · Market cap $100K\n💧 Liquidity $12K · 📊 5m volume $2K'});
 assert.match(legacy.text,/<b>MARKET<\/b>\nMarket cap \$100K\nPrice/);
 assert.doesNotMatch(legacy.text,/Not reported:.*5m volume|Market cap <b>Unavailable/);
});
