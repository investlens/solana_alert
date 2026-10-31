/** Echo shadow-only measurements from ACTUAL verified caller events.
 * The websocket observation and parsed transaction confirmation are measured
 * before Telegram sends. No quotes or reservations are manufactured: their
 * timings remain null until an independently verified provider is connected.
 * This tracker performs no RPC, filesystem writes, signing or broadcasting.
 */
import {SLINGOOR_WALLET,CHAIRMAN_WALLET} from './liveBuyPolicy.js';
import {summarizeEchoShadowLatencies} from './fastFollowerLatencyEvidence.js';

type Caller='Slingoor'|'Chairman';
type Observation={caller:Caller;receivedAtMs:number};
type Sample={caller:Caller;source:'WEBSOCKET'|'RECONCILIATION';
 chainToDetectionMs:number|null;queueWaitMs:number|null;
 verificationMs:number;chainToVerificationMs:number|null;
 staleAtVerification:boolean;quoteMs:null;reservationMs:null;decisionMs:null};
const allowed:ReadonlyMap<string,Caller>=new Map<string,Caller>([[SLINGOOR_WALLET,'Slingoor'],[CHAIRMAN_WALLET,'Chairman']]);
const SIGNATURE=/^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const MAX_PENDING=1024,MAX_SAMPLES=500;
export const ECHO_SHADOW_LATENCY_EXECUTION_ENABLED=false as const;
export class EchoVerifiedBuyLatencyTracker {
 private observations=new Map<string,Observation>();
 private measuredKeys=new Set<string>();
 private samples:Sample[]=[];
 private rejectedClock=0;
 constructor(private readonly now:()=>number=Date.now){}
 websocketObserved(signature:string, wallet:string):void{
  const caller=allowed.get(wallet);
  if(!caller||!SIGNATURE.test(signature)||this.observations.has(wallet+':'+signature))return;
  this.observations.set(wallet+':'+signature,{caller,receivedAtMs:this.now()});
  if(this.observations.size>MAX_PENDING){
   const first=this.observations.keys().next().value;
   if(first)this.observations.delete(first);
  }
 }
 /** Must only be invoked after independent signer + spend/credit validation. */
 verifiedBuy(input:{signature:string;wallet:string;chainTimestampSec:number;
  fetchStartedAtMs:number;verifiedAtMs:number}):void{
  const caller=allowed.get(input.wallet);
  if(!caller||!SIGNATURE.test(input.signature))return;
  const key=input.wallet+':'+input.signature;
  const observation=this.observations.get(key);
  this.observations.delete(key);
  if(this.measuredKeys.has(key))return;
  const chainAt=Math.round(input.chainTimestampSec*1000);
  const {fetchStartedAtMs:start,verifiedAtMs:end}=input;
  if(!Number.isSafeInteger(chainAt)||!Number.isSafeInteger(start)||
    !Number.isSafeInteger(end)||chainAt<=0||start<0||end<start||
    (observation&&observation.receivedAtMs>end)){
   this.rejectedClock++;return;
  }
  this.measuredKeys.add(key);
  if(this.measuredKeys.size>4096){
   const first=this.measuredKeys.values().next().value;
   if(first)this.measuredKeys.delete(first);
  }
  const received=observation?.receivedAtMs??null;
  // BlockTime has one-second precision and can be later than a websocket
  // observation; negative wall-clock differences are unknown, not zero latency.
  const chainToDetectionMs=received!==null&&received>=chainAt?received-chainAt:null;
  const chainToVerificationMs=end>=chainAt?end-chainAt:null;
  const item:Sample={caller,source:received===null?'RECONCILIATION':'WEBSOCKET',
   chainToDetectionMs,
   queueWaitMs:received===null?null:Math.max(0,start-received),
   verificationMs:end-start,chainToVerificationMs,
   staleAtVerification:chainToVerificationMs===null||chainToVerificationMs>5000,
   quoteMs:null,reservationMs:null,decisionMs:null};
  this.samples.push(item);
  if(this.samples.length>MAX_SAMPLES)this.samples.shift();
 }
 /** Compact bounded, identifier-free real measurements, never simulated quote figures. */
 summary(){
  return {mode:'SHADOW_OBSERVE_ONLY',liveTrading:false,
   sampleCount:this.samples.length,rejectedClock:this.rejectedClock,
   quoteStage:'NOT_CONNECTED',reservationStage:'NOT_CONNECTED',
   callers:(['Slingoor','Chairman'] as Caller[]).map(caller=>{
    const all=this.samples.filter(s=>s.caller===caller);
    const ws=all.filter(s=>s.source==='WEBSOCKET');
    return {caller,verifiedBuyEvents:all.length,websocketVerifiedBuys:ws.length,
     reconciliationVerifiedBuys:all.length-ws.length,
     staleAtVerification:ws.filter(s=>s.staleAtVerification).length,
     chainToDetection:summarizeEchoShadowLatencies(ws.flatMap(s=>s.chainToDetectionMs===null?[]:[s.chainToDetectionMs])),
     queueWait:summarizeEchoShadowLatencies(ws.flatMap(s=>s.queueWaitMs===null?[]:[s.queueWaitMs])),
     verification:summarizeEchoShadowLatencies(ws.map(s=>s.verificationMs)),
     chainToVerification:summarizeEchoShadowLatencies(ws.flatMap(s=>s.chainToVerificationMs===null?[]:[s.chainToVerificationMs])),
     quoteMs:null,reservationMs:null,decisionMs:null};
   })};
 }
}
