import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey,Keypair } from '@solana/web3.js';
import {createPumpCandidateQueue,PUMP_CANDIDATE_CAP,selectPumpMarket,addPumpObservation,evaluatePumpMomentum,type PumpMarket} from '../src/chains/solana/pumpfunMomentum.js';
import {decodePumpCurve,decodePumpPool,decodeSupportedMint,PUMP_PROGRAM,PUMP_SWAP,WSOL} from '../src/chains/solana/pumpfunEvidence.js';
const mint=Keypair.generate().publicKey.toBase58(),pair=Keypair.generate().publicKey.toBase58(),creator=Keypair.generate().publicKey.toBase58();
const now=2_000_000;
const market=(at:number,volume=500):PumpMarket=>({mint,pair,symbol:'PUMP',name:'Pump sample',price:at/1e6,marketCap:50000,fdv:60000,liquidity:20000,volume5m:volume,volume24h:10000,change5m:5,change1h:10,buys:30,sells:10,createdAt:1,observedAt:at,socials:[]});
test('only exact-case Solana base tokens in PumpSwap SOL pairs map market data',()=>{
 const raw={chainId:'solana',dexId:'pumpswap',pairAddress:pair,baseToken:{address:mint,symbol:'P',name:'Pump'},quoteToken:{address:WSOL},priceUsd:'0.001',marketCap:10000,fdv:20000,liquidity:{usd:5000},volume:{m5:100,h24:1000},priceChange:{m5:5,h1:0},txns:{m5:{buys:0,sells:0}},pairCreatedAt:1};
 const m=selectPumpMarket([raw],mint,now)!;assert.equal(m.marketCap,10000);assert.equal(m.fdv,20000);assert.equal(m.buys,0);assert.equal(m.change1h,0);
 for(const bad of [{chainId:'arc'},{dexId:'raydium'},{marketCap:null},{volume:{m5:2000,h24:1000}},{baseToken:{address:mint.toLowerCase()}},{txns:{m5:{buys:1.5,sells:1}}}])assert.equal(selectPumpMarket([{...raw,...bad}],mint,now),null);
});
test('candidate storage is capped, case sensitive and expires without DB writes',()=>{
 let time=now;const q=createPumpCandidateQueue(()=>time);
 for(let i=0;i<PUMP_CANDIDATE_CAP;i++)assert.equal(q.seed(Keypair.generate().publicKey.toBase58()),true);
 assert.equal(q.seed(mint),false);assert.equal(q.stats().capacitySkipped,1);
 time+=60*60_000;assert.equal(q.list().length,0);assert.equal(q.seed(mint),true);assert.equal(q.seed(mint),false);
});
function candidate(){return {mint,firstSeen:1,lastChecked:0,samples:[market(now-900000),market(now-600000),market(now-300000),market(now-30000,1100),market(now,1200)]};}
test('volume expansion needs three spaced observed windows and positive price confirmation',()=>{
 assert.equal(evaluatePumpMomentum(candidate(),now).ready,true);
 const c=candidate();c.samples.splice(1,1);assert.equal(evaluatePumpMomentum(c,now).reason,'BASELINE_INCOMPLETE');
 for(const change of [{price:1},{change5m:-1},{sells:0},{volume5m:900},{liquidity:100}]){const c=candidate();Object.assign(c.samples.at(-1)!,change);assert.equal(evaluatePumpMomentum(c,now).ready,false);}
 assert.equal(evaluatePumpMomentum(candidate(),now+90000).ready,false);
});
test('cached samples and pool changes cannot create a false momentum history',()=>{
 const c=candidate();addPumpObservation(c,market(now));assert.equal(c.samples.length,5);
 addPumpObservation(c,{...market(now+30000),pair:Keypair.generate().publicKey.toBase58()});assert.equal(c.samples.length,1);
 assert.equal(evaluatePumpMomentum(c,now+30000).ready,false);
});
function curve(){const b=Buffer.alloc(115);Buffer.from([23,183,248,55,96,216,172,96]).copy(b);b.writeBigUInt64LE(1000000000n,40);b[48]=1;new PublicKey(creator).toBuffer().copy(b,49);return b;}
function pool(){const b=Buffer.alloc(244);Buffer.from([241,154,109,4,17,177,109,188]).copy(b);new PublicKey(mint).toBuffer().copy(b,43);new PublicKey(WSOL).toBuffer().copy(b,75);new PublicKey(pair).toBuffer().copy(b,139);new PublicKey(creator).toBuffer().copy(b,211);return b;}
test('on-chain proof validates owner, discriminator, quote, creator and pool base mint',()=>{
 assert.equal(decodePumpCurve(curve(),PUMP_PROGRAM.toBase58()).creator,creator);
 assert.throws(()=>decodePumpCurve(curve(),PUMP_SWAP.toBase58()));
 const bad=curve();bad[81]=1;assert.throws(()=>decodePumpCurve(bad,PUMP_PROGRAM.toBase58()));
 const other=curve();new PublicKey(mint).toBuffer().copy(other,83);assert.throws(()=>decodePumpCurve(other,PUMP_PROGRAM.toBase58()));
 assert.equal(decodePumpPool(pool(),PUMP_SWAP.toBase58(),mint).creator,creator);
 assert.throws(()=>decodePumpPool(pool(),PUMP_SWAP.toBase58(),pair));
 assert.throws(()=>decodePumpPool(pool(),PUMP_PROGRAM.toBase58(),mint));
});
test('mint controls and unknown Token-2022 extensions fail closed',()=>{
 const b=Buffer.alloc(82);b.writeBigUInt64LE(1000000000n,36);b[44]=6;b[45]=1;
 const legacy='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',token2022='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
 assert.equal(decodeSupportedMint(b,legacy).decimals,6);
 const frozen=Buffer.from(b);frozen.writeUInt32LE(1,46);assert.throws(()=>decodeSupportedMint(frozen,legacy));
 const extended=Buffer.alloc(170);b.copy(extended);extended[165]=1;extended.writeUInt16LE(18,166);assert.equal(decodeSupportedMint(extended,token2022).supply,1000000000n);
 extended.writeUInt16LE(1,166);assert.throws(()=>decodeSupportedMint(extended,token2022));
});
import { pumpMomentumCard } from '../src/chains/solana/pumpfunMomentumWorker.js';
import { telegramCaptionLength } from '../src/ui/alphaosPhotoDelivery.js';
import { cleanAlertCard } from '../src/ui/alertCardLayout.js';
test('momentum card escapes metadata and clearly labels sampled risk evidence',()=>{
 const m={...market(now,1200),name:'Pump <sample>',symbol:'P&X'};
 const card=cleanAlertCard(pumpMomentumCard(m,{creator,devPercent:0,top10SamplePercent:10,supply:1000000000,slot:123,observedAt:now},2.4));
 assert.match(card,/&lt;sample&gt;/);assert.match(card,/P&amp;X/);
 assert.match(card,/Creator fee wallet holding <b>0.00%/);
 assert.match(card,/not a complete holder census/);assert.match(card,/not a buy\/sell signal/);
 assert.ok(telegramCaptionLength(card)<=1024,`caption length ${telegramCaptionLength(card)}`);
});
