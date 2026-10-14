import {recordFeedPoll} from '../../services/feedDeliveryHealth.js';
export type PromotionKind='boost'|'paid';
export type PromotionUpdate={tokenAddress:string;amount?:number;totalAmount?:number};
export const PROMOTION_STREAM_PATHS=[
 ['token-boosts/latest/v1','boost'],['token-profiles/latest/v1','paid'],
 ['token-profiles/recent-updates/v1','paid'],['ads/latest/v1','paid'],
] as const;
// Accept the observed handshake and incremental array formats, not arbitrary objects.
// Strip images, links, descriptions and other provider payload before routing.
export function parsePromotionUpdate(raw:string,kind:PromotionKind,chain='robinhood'):PromotionUpdate[]|null {
 if(raw.length>1_000_000)throw Error('Promotion payload too large');
 const payload=JSON.parse(raw);if(payload?.type==='heartbeat'&&Object.keys(payload).length===1)return null;const rows=Array.isArray(payload)?payload:payload&&Array.isArray(payload.data)?payload.data:null;
 if(!rows)throw Error('Unknown promotion message format');
 const result=new Map<string,PromotionUpdate>();
 for(const row of rows.slice(0,200)) {
  if(row?.chainId!==chain||!/^0x[a-f0-9]{40}$/i.test(row.tokenAddress??''))continue;
  const tokenAddress=row.tokenAddress.toLowerCase();
  if(kind==='boost'){
   if(typeof row.amount!=='number'||typeof row.totalAmount!=='number'||!Number.isFinite(row.amount)||!Number.isFinite(row.totalAmount)||row.amount<=0||row.totalAmount<=0||row.amount>row.totalAmount)continue;
   const prior=result.get(tokenAddress);if(prior&&prior.totalAmount!>=row.totalAmount)continue;
   result.set(tokenAddress,{tokenAddress,amount:row.amount,totalAmount:row.totalAmount});
  }else result.set(tokenAddress,{tokenAddress});
 }
 return [...result.values()];
}
let started=false;
// Four connections in the existing worker; reconnection is bounded and staggered.
export function startPromotionStreams(route:(kind:PromotionKind,rows:PromotionUpdate[],snapshot:boolean)=>void,chain='robinhood'):void {
 if(started||process.env[chain==='arc'?'ARC_PROMOTION_STREAMS_ENABLED':'ROBINHOOD_PROMOTION_STREAMS_ENABLED']==='false')return;
 if(typeof WebSocket==='undefined'){console.warn('[PromotionStreams] unsupported runtime; REST fallback retained');return;}
 started=true;
 for(const [path,kind] of PROMOTION_STREAM_PATHS){
  let failures=0;
  const source=`${chain==='arc'?'ARC':'RH'}_${path.split('/').slice(0,2).join('_').replace(/-/g,'_').toUpperCase()}_STREAM`;
  const connect=()=>{
   let first=true,closed=false;
   const socket=new WebSocket(`wss://api.dexscreener.com/${path}`);
   const deadline=setTimeout(()=>{if(socket.readyState!==WebSocket.OPEN)socket.close();},10000);deadline.unref();
   socket.onopen=()=>{clearTimeout(deadline);console.log('[PromotionStreams] CONNECTED',{path});};
   socket.onmessage=event=>{
    try{const rows=parsePromotionUpdate(String(event.data),kind,chain);recordFeedPoll(source,'OK',rows?.length??0);if(rows===null)return;route(kind,rows,first);first=false;failures=0;
     console.log('[PromotionStreams] UPDATE',{path,chain,matched:rows.length});}
    catch{recordFeedPoll(source,'UNAVAILABLE');console.warn('[PromotionStreams] malformed update withheld',{path});socket.close();}
   };
   socket.onerror=()=>socket.close();
   socket.onclose=()=>{if(closed)return;closed=true;clearTimeout(deadline);recordFeedPoll(source,'UNAVAILABLE');
    const delay=Math.min(60000,1000*2**Math.min(failures++,6))+Math.floor(Math.random()*1000);
    console.warn('[PromotionStreams] DISCONNECTED',{path,retryMs:delay});const retry=setTimeout(connect,delay);retry.unref();};
  };connect();
 }
}
