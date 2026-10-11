import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanAlertCard } from '../src/ui/alertCardLayout.js';
import { buildPromotionEventCard } from '../src/ui/promotionEventCard.js';
const token='0x'+'a'.repeat(40);
test('promotion lock disclosure distinguishes missing proof, unlocked and prebond without changing actions',()=>{
 for(const kind of ['BOOST','DEX_PAID','SOCIAL_MAFIA'] as const){
  const args={kind,token,launchType:'UNKNOWN',stats:{},securityNote:null,buttons:[],text:'Price $0.1'};
  const unknown=buildPromotionEventCard(args);
  assert.match(unknown.text,/LP lock: <b>Unable to verify/);
  assert.doesNotMatch(unknown.text,/LP lock: <b>Unlocked/);
  const unlocked=buildPromotionEventCard({...args,stats:{lp:'UNLOCKED'},securityNote:'⚠️ LP unlocked · liquidity can be removed. Honeypot/sell-restriction checks passed.'});
  assert.match(unlocked.text,/LP lock: <b>Unlocked/);
  assert.match(unlocked.text,/Honeypot\/sell-restriction checks passed/);
  assert.doesNotMatch(unlocked.text,/liquidity can be removed/);
  assert.deepEqual(unlocked.buttons,unknown.buttons);
  const curve=buildPromotionEventCard({...args,stats:{preBond:true}});
  assert.match(curve.text,/Not applicable · bonding curve/);
 }
});
test('legacy lock rows become concise risk notes and keep detailed verified evidence',()=>{
 const render=(status:string)=>cleanAlertCard(`<b>BOOST DETECTED</b>\n<b>KEY STATS</b>\nLP lock status <b>${status}</b>\n\n<code>${token}</code>`);
 const unknown=render('Not independently checked');
 assert.match(unknown,/Unable to verify/);assert.doesNotMatch(unknown,/Unlocked/);
 assert.equal(cleanAlertCard(unknown),unknown);
 assert.match(render('UNLOCKED'),/LP lock: <b>Unlocked/);
 assert.match(render('LOCKED'),/LP lock: <b>Locked/);
 assert.match(render('BURNED'),/LP lock: <b>Burned/);
 assert.match(render('50% locked until 2027'),/50% locked until 2027/);
});
test('promotion cards carry gate LP evidence even when market cache has no lock result',()=>{
 const args={kind:'BOOST' as const,token,launchType:'UNKNOWN',stats:{},securityNote:'custom security warning: ⚠️ HIGH RISK — LP UNLOCKED: 100% removable.',buttons:[],text:'Price $0.1'};
 assert.match(buildPromotionEventCard({...args,lpStatus:'UNLOCKED'}).text,/LP lock: <b>Unlocked/);
 assert.match(buildPromotionEventCard({...args,lpStatus:'BURNED',securityNote:'LP PROTECTED'}).text,/LP lock: <b>Burned/);
 assert.match(buildPromotionEventCard({...args,lpStatus:'LOCKED',securityNote:'LP PROTECTED'}).text,/LP lock: <b>Locked/);
 assert.match(buildPromotionEventCard({...args,lpStatus:'UNKNOWN'}).text,/LP lock: <b>Unable to verify/);
});
