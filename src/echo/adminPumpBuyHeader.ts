/**
 * Exact Pump bonding curve buy_v2/buy_v3 instruction header decoder.
 * Uses discriminators from pump-fun/pump-public-docs/idl/pump.ts.
 * This is read-only and NOT sufficient to certify a completed BUY.
 */
import {PUMP_CURVE_PROGRAM} from './adminPumpVenue.js';
export type PumpBuyHeader=Readonly<{
 version:'buy_v2'|'buy_v3';amount:bigint;maxQuoteCost:bigint;
 partialFillByte:number|null;verifiedBuy:false
}>;
const V2=[184,23,238,97,103,197,211,61];
const V3=[7,5,29,196,245,23,101,80];
function eq(a:Uint8Array,b:readonly number[]):boolean{
 return b.every((v,i)=>a[i]===v);
}
function u64le(data:Uint8Array,start:number):bigint{
 let result=0n;
 for(let i=0;i<8;i++)result|=BigInt(data[start+i]! )<<(8n*BigInt(i));
 return result;
}
export function decodePumpBuyHeader(programId:string,data:Uint8Array):PumpBuyHeader|null{
 if(programId!==PUMP_CURVE_PROGRAM||data.length<24)return null;
 const version=eq(data,V2)?'buy_v2':eq(data,V3)?'buy_v3':null;
 if(!version)return null;
 const amount=u64le(data,8),maxQuoteCost=u64le(data,16);
 if(amount<=0n||maxQuoteCost<=0n)return null;
 // Both variants have additional optionBool data; caller must verify
 // the complete layout against the versioned official IDL.
 const partialFillByte=data.length>24?data[24]!:null;
 return {version,amount,maxQuoteCost,partialFillByte,verifiedBuy:false};
}
