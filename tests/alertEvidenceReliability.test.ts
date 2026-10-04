import test from 'node:test';
import assert from 'node:assert/strict';
import { createRejectedCandidateReview, comparableReviewPrice } from '../src/services/rejectedCandidateReview.js';
import { renderFeedHealth } from '../src/services/feedDeliveryHealth.js';
import { freshPositionBaseline } from '../src/services/positionCheckService.js';
import { renderWalletLinkResearch } from '../src/services/walletLinkResearch.js';
import type { RobinhoodBundleIntelligenceResult } from '../src/chains/robinhood/security/bundleIntelligence.js';
const token = '0x'+'1'.repeat(40), pair='0x'+'2'.repeat(40);
test('rejected review requires the exact chain, token and pool, never substitutes another market',()=>{
 const row={chain:'arc' as const,token,pair,price:1,reason:'market threshold',at:1};
 const p={chainId:'arc',baseToken:{address:token},pairAddress:pair,priceUsd:'2'};
 assert.equal(comparableReviewPrice([p],row),2);
 for(const change of [{chainId:'robinhood'},{baseToken:{address:pair}},{pairAddress:token},{priceUsd:null},{priceUsd:''}]) assert.equal(comparableReviewPrice([{...p,...change}],row),null);
});
test('sample caps, checkpoints, unavailable evidence, alert removal and expiry stay bounded',async()=>{
 let now=1_000_000,calls=0;
 const review=createRejectedCandidateReview(async()=>{calls++;throw Error('provider down');},()=>now);
 for(let i=0;i<20;i++)review.admit({chain:'arc',token:'0x'+i.toString(16).padStart(40,'0'),pair,price:1,reason:'threshold'});
 assert.equal(review.snapshot().pending,6); assert.equal(await review.tick(),false);
 now+=30*60_000; assert.equal(await review.tick(),true); assert.equal(await review.tick(),false); assert.equal(calls,1);
 assert.equal(review.snapshot().reviews[0].status,'UNAVAILABLE');assert.equal(review.snapshot().reviews[0].change,null);
 review.alerted('arc',review.snapshot().reviews[0].token);assert.equal(review.snapshot().reviews.length,0);
 now+=2*3_600_000+1;assert.equal(review.snapshot().pending,0);
});
test('later alerted tokens cannot be readmitted as missed opportunities during retention',()=>{
 const review=createRejectedCandidateReview(async()=>[],()=>1_000_000);
 review.alerted('arc',token);review.admit({chain:'arc',token,pair,price:1,reason:'threshold'});assert.equal(review.snapshot().pending,0);
});
test('delivery diagnostics distinguish mute, preference outages and accepted sends without inferring worker failure',()=>{
 const now=1_000_000;
 const text=renderFeedHealth([{name:'Main',snapshot:{startedAt:1,observedAt:now,feeds:{DEX_PAID:{MUTED:2,PREFERENCES_UNAVAILABLE:3,ACCEPTED:1}}}},{name:'ARC',snapshot:null}],now);
 assert.match(text,/muted 2.*preference errors 3.*accepted 1/);assert.match(text,/Health unknown/);assert.match(text,/Eligible does not mean sent/);
 assert.match(renderFeedHealth([{name:'Main',snapshot:{startedAt:1,observedAt:1,feeds:{}}}],4_000_000),/Health unknown/);
});
test('creator comparison baselines expire after an hour and reject future timestamps',()=>{
 assert.equal(freshPositionBaseline({creator:token,holding:1,at:1},3_600_002),undefined);
 assert.equal(freshPositionBaseline({creator:token,holding:1,at:2},1),undefined);
 assert.equal(freshPositionBaseline({creator:token,holding:1,at:1},2)?.holding,1);
});
test('wallet links disclose sample limits and never equate unknown data with independent ownership',()=>{
 const unknown={tokenAddress:token,evidenceAvailable:false,reasons:['provider <unavailable>']} as unknown as RobinhoodBundleIntelligenceResult;
 assert.match(renderWalletLinkResearch(unknown),/not evidence of independent wallets/);assert.match(renderWalletLinkResearch(unknown),/&lt;unavailable&gt;/);
 const text=renderWalletLinkResearch({...unknown,evidenceAvailable:true,scannedAt:1,connectedWallets:[token],metrics:{devSpreadDestinationCount:2,devDestinationsStillTopHolders:2,connectedCurrentSupplyPct:12,sampledHolderCount:10}} as RobinhoodBundleIntelligenceResult);
 assert.match(text,/not common ownership or a confirmed sale/);assert.match(text,/Similar balances alone/);assert.ok(text.length<2500);
});
