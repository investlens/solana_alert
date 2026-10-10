import { PublicKey } from '@solana/web3.js';
export type PumpMarket={mint:string;pair:string;symbol:string;name:string;price:number;marketCap:number;fdv:number|null;liquidity:number;volume5m:number;volume24h:number;change5m:number;change1h:number|null;buys:number;sells:number;createdAt:number;observedAt:number;socials:{label:string;url:string}[]};
export type PumpCandidate={mint:string;firstSeen:number;samples:PumpMarket[];lastChecked:number};
export const PUMP_CANDIDATE_CAP=120;
export const PUMP_RETENTION_MS=60*60_000;
const validKey=(value:unknown)=>{try{return typeof value==='string'&&new PublicKey(value).toBase58()===value;}catch{return false;}};
const number=(v:unknown):number|null=>{if(v==null||typeof v==='boolean'||String(v).trim()==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};
export function selectPumpMarket(payload:unknown,mint:string,at:number):PumpMarket|null {
 if(!Array.isArray(payload)||!validKey(mint))return null;
 const matching=payload.filter(p=>p?.chainId==='solana'&&p?.dexId==='pumpswap'&&p?.baseToken?.address===mint&&p?.quoteToken?.address==='So11111111111111111111111111111111111111112'&&validKey(p?.pairAddress));
 // One pool identity throughout the history; a different venue starts a new baseline.
 const p=matching.sort((a,b)=>(number(b.liquidity?.usd)??0)-(number(a.liquidity?.usd)??0))[0];if(!p)return null;
 const price=number(p.priceUsd),mc=number(p.marketCap),lp=number(p.liquidity?.usd),v5=number(p.volume?.m5),v24=number(p.volume?.h24),change=number(p.priceChange?.m5),buys=number(p.txns?.m5?.buys),sells=number(p.txns?.m5?.sells),created=number(p.pairCreatedAt);
 if([price,mc,lp,v5,v24,change,buys,sells,created].some(v=>v===null)||price!<=0||mc!<=0||lp!<=0||v5!<0||v24!<v5!||buys!<0||sells!<0||!Number.isInteger(buys)||!Number.isInteger(sells)||created!>at||created!<=0)return null;
 if(!String(p.baseToken.symbol??'').trim()||!String(p.baseToken.name??'').trim())return null;
 const socials:PumpMarket['socials']=[];
 for(const s of p.info?.socials??[]) {const label=/^(twitter|x)$/i.test(s.type)?'X':/^telegram$/i.test(s.type)?'TG':null;try{const url=new URL(s.url);if(label&&url.protocol==='https:'&&((label==='X'&&['x.com','twitter.com'].includes(url.hostname))||(label==='TG'&&url.hostname==='t.me')))socials.push({label,url:url.href});}catch{}}
 return {mint,pair:p.pairAddress,symbol:String(p.baseToken.symbol??'').slice(0,24),name:String(p.baseToken.name??'').slice(0,60),price:price!,marketCap:mc!,fdv:number(p.fdv),liquidity:lp!,volume5m:v5!,volume24h:v24!,change5m:change!,change1h:number(p.priceChange?.h1),buys:buys!,sells:sells!,createdAt:created!,observedAt:at,socials};
}
export function createPumpCandidateQueue(now=Date.now) {
 const candidates=new Map<string,PumpCandidate>();let capacitySkipped=0;
 const prune=()=>{for(const [key,v] of candidates)if(now()-v.firstSeen>=PUMP_RETENTION_MS)candidates.delete(key);};
 return {seed(mint:string){prune();if(!validKey(mint)||candidates.has(mint))return false;if(candidates.size>=PUMP_CANDIDATE_CAP){capacitySkipped++;return false;}candidates.set(mint,{mint,firstSeen:now(),samples:[],lastChecked:0});return true;},
  list(){prune();return [...candidates.values()].sort((a,b)=>a.lastChecked-b.lastChecked);},remove(mint:string){candidates.delete(mint);},stats(){prune();return {candidates:candidates.size,capacitySkipped,cap:PUMP_CANDIDATE_CAP};}};
}
export function addPumpObservation(candidate:PumpCandidate,market:PumpMarket) {
 if(market.mint!==candidate.mint)throw new Error('Candidate identity mismatch');
 const previous=candidate.samples.at(-1);
 if(previous&&previous.pair!==market.pair)candidate.samples=[];
 if(previous&&previous.pair===market.pair&&market.observedAt<=previous.observedAt)return;
 candidate.samples.push(market);candidate.samples=candidate.samples.filter(v=>market.observedAt-v.observedAt<=20*60_000).slice(-50);
}
export function evaluatePumpMomentum(candidate:PumpCandidate,now:number):{ready:boolean;reason:string;ratio?:number} {
 const current=candidate.samples.at(-1),previous=candidate.samples.at(-2);
 if(!current||!previous||now-current.observedAt>60_000||now<current.observedAt)return {ready:false,reason:'FRESH_MARKET_REQUIRED'};
 if(now-current.createdAt<2*60_000||now-current.createdAt>60*60_000)return {ready:false,reason:'PAIR_AGE'};
 if(current.price<=previous.price||current.change5m<=0||current.observedAt-previous.observedAt<20_000||current.observedAt-previous.observedAt>90_000)return {ready:false,reason:'PRICE_CONFIRMATION'};
 if(current.liquidity<5000||current.volume5m<1000||current.buys<20||current.sells<1||current.buys/current.sells<1.5)return {ready:false,reason:'ACTIVITY_WAIT'};
 let end=current.observedAt;const baseline:PumpMarket[]=[];
 for(let i=0;i<3;i++) {const sample=[...candidate.samples].reverse().find(v=>v.observedAt<=end-300_000);if(!sample||end-sample.observedAt>360_000)return {ready:false,reason:'BASELINE_INCOMPLETE'};baseline.push(sample);end=sample.observedAt;}
 const average=baseline.reduce((s,v)=>s+v.volume5m,0)/3;
 if(average<100)return {ready:false,reason:'BASELINE_TOO_SMALL'};
 const ratio=current.volume5m/average;return {ready:ratio>=2,reason:ratio>=2?'QUALIFIED':'VOLUME_WAIT',ratio};
}
