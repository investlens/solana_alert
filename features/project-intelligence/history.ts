import {address,type Chain,type Finding} from './model.js';
import {validPriorWinner} from '../../src/chains/robinhood/ponsReturningWinner.js';
export type HistoryReader=(chain:Chain,creator:string)=>Promise<{summary:unknown;winners:unknown}>;
// Exact indexed wallet reads only. No all-developer snapshot, scans, or writes.
export function createHistoryReader(base:string,key:string,fetcher:typeof fetch=fetch):HistoryReader{
 const origin=new URL(base);if(origin.protocol!=='https:'||origin.username||origin.password)throw Error('Invalid history provider');
 return async(chain,creator)=>{
  if(!address(creator))throw Error('Invalid developer');
  const read=async(table:string,columns:string,limit:number,order?:string)=>{
   const url=new URL('/rest/v1/'+table,origin);url.searchParams.set('select',columns);url.searchParams.set('chain','eq.'+chain);url.searchParams.set('creator','eq.'+creator);url.searchParams.set('limit',String(limit));if(order)url.searchParams.set('order',order);
   const response=await fetcher(url,{headers:{apikey:key,Authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(2500)});
   if(!response.ok||Number(response.headers.get('content-length')??0)>65536)throw Error('History unavailable');
   const reader=response.body?.getReader();if(!reader)throw Error('History unavailable');let size=0;const chunks:Uint8Array[]=[];
   try{while(true){const result=await reader.read();if(result.done)break;size+=result.value.length;if(size>65536)throw Error('History response too large');chunks.push(result.value);}}catch(e){await reader.cancel();throw e;}finally{reader.releaseLock();}
   return JSON.parse(Buffer.concat(chunks).toString());
  };
  const summary=await read('alpha_creator_outcome_summary','chain,creator,assessed_sessions,winners,failed,neutral,incomplete,last_assessed_at',1);
  const winners=await read('alpha_successful_tokens','chain,token,creator,creator_source,price_unit,baseline_price,final_roi,sampled_low_roi,samples,assessed_at',3,'assessed_at.desc');
  return {summary,winners};
 };
}
export function historyFindings(chain:Chain,creator:string,token:string,payload:{summary:unknown;winners:unknown},at:string):Finding[]{
 if(!Array.isArray(payload.summary)||payload.summary.length!==1||!Array.isArray(payload.winners)||payload.winners.length>3)return [];
 const row=payload.summary[0];if(row?.chain!==chain||row?.creator?.toLowerCase()!==creator.toLowerCase())return [];
 const counts=['assessed_sessions','winners','failed','neutral','incomplete'].map(k=>typeof row[k]==='number'||typeof row[k]==='string'&&/^\d+$/.test(row[k])?Number(row[k]):NaN);
 if(counts.some(n=>!Number.isSafeInteger(n)||n<0)||counts[0]!==counts.slice(1).reduce((a,b)=>a+b,0)||!Number.isFinite(Date.parse(row.last_assessed_at))||Date.parse(row.last_assessed_at)>Date.parse(at))return [];
 const evidence=[{source:'AlphaOS retained measured outcomes',observedAt:at}];
 const findings:Finding[]=[{id:'recorded-developer-outcomes',section:'launches',quality:'SOURCE_REPORTED',severity:'INFO',subject:creator,summary:`Recorded sessions: ${counts[1]} winners, ${counts[2]} failed, ${counts[3]} other, ${counts[4]} incomplete.`,value:counts[0],evidence,limits:'Historical assessed sessions, not lifetime launch counts or unique projects. Records may include this token. Failed performance does not establish fraud. Coverage is partial.'}];
 // Reuse measured ROI validation, which currently supports Robinhood only.
 if(chain==='robinhood')for(const winner of payload.winners){
  if(!validPriorWinner(winner,creator)||winner.token.toLowerCase()===token.toLowerCase()||Date.parse(winner.assessed_at)>Date.parse(at))continue;
  findings.push({id:'recorded-winner:'+winner.token.toLowerCase(),section:'launches',quality:'SOURCE_REPORTED',severity:'INFO',subject:winner.token.toLowerCase(),value:winner.final_roi,summary:`Recorded winner: +${winner.final_roi.toFixed(1)}% (${winner.price_unit==='USD'?'USD price':'curve reserve ratio'}, six-hour sampled outcome).`,evidence:[{...evidence[0],url:'https://robinhoodchain.blockscout.com/token/'+winner.token}],limits:'Recomputed from retained samples, not a new market-price check or promised return. At most three latest retained winners inspected.'});
 }
 return findings;
}
