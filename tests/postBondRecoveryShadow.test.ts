import test from 'node:test';
import assert from 'node:assert/strict';
import { PostBondRecoveryShadow } from '../src/chains/robinhood/postBondRecoveryShadow.js';
import type { SetupMarketEvidence } from '../src/chains/robinhood/setupMarketEvidence.js';
const sample = (at:number, price:number, volume5m:number, extra:Partial<SetupMarketEvidence> = {}):SetupMarketEvidence =>
  ({at,price,depth:10000,source:'DEX',pair:'pool',marketCap:100000,fdv:100000,volume5m,volume24h:10000,buys5m:5,sells5m:2,...extra});
test('postbond recovery needs pullback and consecutive demand, then includes losing outcome',()=>{
 const shadow=new PostBondRecoveryShadow();
 const points=[sample(0,100,100),sample(60000,90,80),sample(120000,92,100),sample(180000,94,120)];
 for(const p of points.slice(0,3))assert.equal(shadow.observe('token',p,p.at).length,0);
 assert.equal(shadow.observe('token',points[3],180000)[0].kind,'SIGNAL');
 const result=shadow.observe('token',sample(240000,85,130),240000)[0];
 assert.equal(result.kind,'COMPLETE');assert.ok(result.referenceReturnPct!<0);
 assert.equal(result.fillAssumed,false);assert.equal(result.feesSlippageIncluded,false);
 assert.equal(shadow.observe('token',sample(300000,120,200),300000).length,0);
});
test('missing, stale, contradictory and prebond data do not produce setups',()=>{
 for(const extra of [{volume5m:null},{volume5m:20000},{marketCap:null},{source:'CURVE' as const},{buys5m:null}]){
  const shadow=new PostBondRecoveryShadow();
  [100,90,92,95].forEach((price,i)=>assert.equal(shadow.observe('token',sample(i*60000,price,100+i*10,extra),i*60000).length,0));
  assert.equal(shadow.summary().signals,0);
 }
 const shadow=new PostBondRecoveryShadow();shadow.observe('token',sample(0,100,100),100000);
 assert.equal(shadow.summary().active,0);
});
test('cached timestamps and absent demand never confirm recovery',()=>{
 const shadow=new PostBondRecoveryShadow();
 for(const p of [sample(0,100,100),sample(60000,90,80),sample(120000,92,100),sample(120000,94,120)])shadow.observe('token',p,p.at);
 assert.equal(shadow.summary().signals,0);
 const flat=new PostBondRecoveryShadow();
 [100,90,92,95].forEach((price,i)=>flat.observe('token',sample(i*60000,price,100),i*60000));
 assert.equal(flat.summary().signals,0);
});
test('a rising base is not mistaken for a pullback low',()=>{
 const shadow=new PostBondRecoveryShadow();
 [100,110,120,121].forEach((price,i)=>shadow.observe('token',sample(i*60000,price,100+i*20),i*60000));
 assert.equal(shadow.summary().signals,0);
});
test('observation gaps count incomplete instead of pretending a profitable exit',()=>{
 const shadow=new PostBondRecoveryShadow();
 [100,90,92,94].forEach((price,i)=>shadow.observe('token',sample(i*60000,price,80+i*20),i*60000));
 const result=shadow.expire(400000)[0];assert.equal(result.kind,'INCOMPLETE');
 assert.equal(result.referenceReturnPct,undefined);
});
test('watch memory remains bounded',()=>{
 const shadow=new PostBondRecoveryShadow();
 for(let i=0;i<100;i++)shadow.observe('token'+i,sample(0,100,100),0);
 assert.equal(shadow.summary().active,20);shadow.expire(7200001);assert.equal(shadow.summary().active,0);
});

test('changing DEX pair invalidates an active signal',()=>{
 const shadow=new PostBondRecoveryShadow();
 [100,90,92,94].forEach((price,i)=>shadow.observe('token',sample(i*60000,price,80+i*20),i*60000));
 const result=shadow.observe('token',sample(240000,100,200,{pair:'other'}),240000)[0];
 assert.equal(result.kind,'INCOMPLETE');assert.equal(result.reason,'PAIR_CHANGED');
});
