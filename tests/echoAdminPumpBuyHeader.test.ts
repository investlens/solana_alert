import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {decodePumpBuyHeader} from '../src/echo/adminPumpBuyHeader.js';
import {PUMP_CURVE_PROGRAM} from '../src/echo/adminPumpVenue.js';
const make=(discriminator:number[])=>{
 const b=new Uint8Array(25);b.set(discriminator);
 b[8]=1;b[16]=255;b[17]=255;b[18]=255;b[19]=255;b[20]=255;b[21]=255;b[22]=31;
 return b;
};
describe('Pump official buy header decoder',()=>{
 it('reads v2 and v3 exact little-endian u64s without granting BUY authorization',()=>{
  for(const [disc,version] of [
   [[184,23,238,97,103,197,211,61],'buy_v2'],
   [[7,5,29,196,245,23,101,80],'buy_v3'],
  ] as const){
   const result=decodePumpBuyHeader(PUMP_CURVE_PROGRAM,make([...disc]));
   assert.equal(result?.version,version);
   assert.equal(result?.amount,1n);
   assert.equal(result?.maxQuoteCost,9007199254740991n);
   assert.equal(result?.verifiedBuy,false);
  }
 });
 it('rejects unknown discriminator, short data and wrong program',()=>{
  assert.equal(decodePumpBuyHeader(PUMP_CURVE_PROGRAM,new Uint8Array(23)),null);
  assert.equal(decodePumpBuyHeader(PUMP_CURVE_PROGRAM,new Uint8Array(25)),null);
  assert.equal(decodePumpBuyHeader('11111111111111111111111111111111',make([184,23,238,97,103,197,211,61])),null);
 });
});
