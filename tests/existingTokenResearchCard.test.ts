import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOpportunityMessage,buildButtons} from '../src/services/opportunityDeliveryService.js';
const token='0xadfb164b5db92fb2f721719261c431185a49344f';
const base={id:55491,asset_id:token,chain:'robinhood',strategy_key:'EXISTING_TOKEN_REIGNITION',recommended_action:'CHECK_ENTRY',status:'NEW',title:'VANTOR TREND REVERSAL',why:'Price retention, participation, and liquidity agree.',what_happened:null,invalidation:null,risk_reason:null,confidence:72,risk_score:42,raw_data:{symbol:'VANTOR',name:'VANTOR',marketCap:24800,liquidity:12800,volume5m:1100,currentRoi:107.6087,elapsedSec:37116,previousIntelligenceState:'COOLING',intelligenceState:'CONFIRMED',observations:Array(12).fill({}),devHoldingEvidence:'UNAVAILABLE',burnEvidence:'UNAVAILABLE'}};
test('VANTOR regression: ordered fact card, unavailable safety and no placeholder scores',()=>{
 const text=buildOpportunityMessage(base);
 const headings=['ALPHAOS · TREND REVERSAL','MOMENTUM','MARKET','DEV &amp; SAFETY','ALPHAOS VIEW'];
 let at=-1;for(const h of headings){const next=text.indexOf(h);assert.ok(next>at);at=next;}
 assert.match(text,/COOLING → <b>CONFIRMED/);assert.match(text,/12 monitoring checkpoints/);
 assert.match(text,/Since monitoring <b>\+107\.61%/);assert.match(text,/Monitored 10h 18m/);
 assert.match(text,/Market cap <b>\$24\.8K/);assert.match(text,/Dev holding <b>Unverified/);
 assert.match(text,/LP protection <b>Unverified/);assert.match(text,/Selling <b>Unverified/);
 assert.match(text,/Robinchain · Origin unverified/);assert.doesNotMatch(text,/72|Confidence|Risk:|RESEARCH ASSESSMENT|Age|ROBINHOOD · PONS/);
 assert.ok(text.length<4096);
});
test('only exact final-gate origin evidence labels PONS; exempt sell test is explicit',()=>{
 const raw={...base.raw_data,launchType:'PONS',alertSafetyDisplay:{token:'0x'+'f'.repeat(40),launchType:'PONS' as const,sellabilityVerified:false}};
 assert.match(buildOpportunityMessage({...base,raw_data:raw}),/Origin unverified/);
 raw.alertSafetyDisplay.token=token;
 const text=buildOpportunityMessage({...base,raw_data:raw});assert.match(text,/Robinchain · PONS/);
 assert.match(text,/PONS origin verified · custom sell test exempt/);assert.doesNotMatch(text,/Selling <b>Same-wallet/);
});
test('custom facts preserve LP warnings and verified ownership without blanket safety claims',()=>{
 for(const lpStatus of ['UNLOCKED','LOCKED','BURNED','UNKNOWN']){
  const raw={...base.raw_data,devHoldingEvidence:'VERIFIED',devHoldingPercent:2.5,burnEvidence:'VERIFIED',totalBurnPercent:1.5,top10Percent:31,top10Evidence:'VERIFIED',alertSafetyDisplay:{token,launchType:null,sellabilityVerified:true,lpStatus}};
  const text=buildOpportunityMessage({...base,raw_data:raw});assert.match(text,/Dev holding <b>2\.5%/);assert.match(text,/Verified burned supply <b>1\.5%/);
  assert.match(text,/Top 10 <b>31%/);assert.match(text,/Same-wallet exit verified/);
  if(lpStatus==='UNLOCKED')assert.match(text,/LIQUIDITY NOT LOCKED/);
  if(lpStatus==='UNKNOWN')assert.match(text,/LP protection <b>Unverified/);
  assert.doesNotMatch(text,/Risk:|safe\b|72\/100/i);
 }
});
test('the correction retains escape handling, primary buttons and original EXIT rendering',()=>{
 const text=buildOpportunityMessage({...base,raw_data:{...base.raw_data,name:'<script>',symbol:'A&B',top10Evidence:'VERIFIED',top10Percent:150,devHoldingEvidence:'VERIFIED',devHoldingPercent:150}});
 assert.match(text,/&lt;script&gt;/);assert.match(text,/A&amp;B/);assert.match(text,/Dev holding <b>Unverified/);assert.doesNotMatch(text,/<script>|150%/);
 const user={telegram_id:'1',role:'admin',is_pro:true} as any;
 const target={chain:'robinhood',tokenAddress:token,chartUrl:'https://dexscreener.com/robinhood/'+token,tokenUrl:'https://robinhoodchain.blockscout.com/token/'+token,label:'Chart',marketIndexState:'VERIFIED',marketContext:{chartUrl:'https://dexscreener.com/robinhood/'+token}} as any;
 const buttons=buildButtons(base,target,user).flat();assert.ok(buttons.some(x=>/Chart/.test(x.text)));assert.ok(buttons.some(x=>/Track/.test(x.text)));assert.ok(buttons.some(x=>/Copy CA/.test(x.text)));assert.ok(buttons.some(x=>/Full Intel/.test(x.text)));
 const exit=buildOpportunityMessage({...base,recommended_action:'EXIT'});assert.match(exit,/DETERIORATION OBSERVED/);assert.doesNotMatch(exit,/ALPHAOS · TREND REVERSAL/);
});
