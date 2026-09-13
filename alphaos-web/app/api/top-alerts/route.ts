import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type AlertItem = {
  id: string; token: string; symbol: string; name: string | null;
  chain: "solana" | "robinhood" | "unknown"; score: number | null;
  alertPrice: number | null; currentPrice: number | null; peakPrice: number | null;
  roiHigh: number | null; roiNow: number | null; alertedAt: string | null; alertType: string | null;
};
type Payload = { solanaTop: AlertItem[]; robinhoodTop: AlertItem[]; recent: AlertItem[]; generatedAt: string; degraded?: boolean };
let cache: Payload | null = null;
const numeric=(v:unknown)=>{if(v===null||v===undefined||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const roi=(a:number|null,p:number|null)=>a&&p!==null?((p-a)/a)*100:null;
function mapSolana(row:any):AlertItem{const alertPrice=numeric(row.alert_price);const currentPrice=numeric(row.current_price)??alertPrice;const peakPrice=numeric(row.high_price_after_alert)??currentPrice;return{id:`sol-${row.id}`,token:String(row.token_address??""),symbol:row.symbol?String(row.symbol):"UNKNOWN",name:row.name?String(row.name):null,chain:"solana",score:numeric(row.score_at_alert),alertPrice,currentPrice,peakPrice,roiHigh:roi(alertPrice,peakPrice),roiNow:roi(alertPrice,currentPrice),alertedAt:row.alerted_at?String(row.alerted_at):null,alertType:row.alert_type?String(row.alert_type):null}}
function mapRobinhood(row:any):AlertItem{const alertPrice=numeric(row.price_at_alert);const currentPrice=numeric(row.current_price)??alertPrice;const peakPrice=numeric(row.peak_price)??currentPrice;return{id:`rh-${row.id}`,token:String(row.token_address??""),symbol:row.symbol?String(row.symbol):"UNKNOWN",name:row.name?String(row.name):null,chain:"robinhood",score:numeric(row.security_score),alertPrice,currentPrice,peakPrice,roiHigh:numeric(row.roi_high_percent)??roi(alertPrice,peakPrice),roiNow:numeric(row.roi_now_percent)??roi(alertPrice,currentPrice),alertedAt:row.alerted_at?String(row.alerted_at):null,alertType:"PONS"}}
function recentUnique(items:AlertItem[]){
  const ordered=[...items].sort((a,b)=>new Date(b.alertedAt??0).getTime()-new Date(a.alertedAt??0).getTime());
  const seen=new Set<string>();
  const result:AlertItem[]=[];
  for(const item of ordered){
    const normalizedSymbol=item.symbol.trim().toUpperCase();
    const key=normalizedSymbol&&normalizedSymbol!=="UNKNOWN"?`symbol:${normalizedSymbol}`:`token:${item.chain}:${item.token.toLowerCase()}`;
    if(seen.has(key))continue;
    seen.add(key);result.push(item);
    if(result.length===10)break;
  }
  return result;
}

export async function GET(){
 try{
  const solSelect="id, token_address, symbol, name, score_at_alert, alert_price, current_price, high_price_after_alert, alerted_at, alert_type";
  const rhSelect="id, token_address, symbol, name, security_score, price_at_alert, current_price, peak_price, roi_high_percent, roi_now_percent, alerted_at";
  const [solAll,rhAll,solRecent,rhRecent]=await Promise.all([
   supabaseAdmin.from("alerts").select(solSelect).gt("alert_price",0).gt("high_price_after_alert",0).limit(500).abortSignal(AbortSignal.timeout(3500)),
   supabaseAdmin.from("robinhood_observations").select(rhSelect).not("alerted_at","is",null).gt("price_at_alert",0).gt("peak_price",0).order("roi_high_percent",{ascending:false}).limit(25).abortSignal(AbortSignal.timeout(3500)),
   supabaseAdmin.from("alerts").select(solSelect).order("alerted_at",{ascending:false}).limit(50).abortSignal(AbortSignal.timeout(3500)),
   supabaseAdmin.from("robinhood_observations").select(rhSelect).not("alerted_at","is",null).order("alerted_at",{ascending:false}).limit(50).abortSignal(AbortSignal.timeout(3500))
  ]);
  if(solAll.error)throw solAll.error;if(rhAll.error)throw rhAll.error;if(solRecent.error)throw solRecent.error;if(rhRecent.error)throw rhRecent.error;
  const solanaTop=(solAll.data??[]).map(mapSolana).filter(a=>a.roiHigh!==null).sort((a,b)=>(b.roiHigh??-Infinity)-(a.roiHigh??-Infinity)).slice(0,10);
  const robinhoodTop=(rhAll.data??[]).map(mapRobinhood).filter(a=>a.roiHigh!==null).sort((a,b)=>(b.roiHigh??-Infinity)-(a.roiHigh??-Infinity)).slice(0,10);
  const recent=recentUnique([...(solRecent.data??[]).map(mapSolana),...(rhRecent.data??[]).map(mapRobinhood)]);
  const payload:Payload={solanaTop,robinhoodTop,recent,generatedAt:new Date().toISOString()};cache=payload;
  return NextResponse.json({success:true,data:payload});
 }catch(error){console.error("top-alerts",error);if(cache)return NextResponse.json({success:true,data:{...cache,degraded:true}});return NextResponse.json({success:true,data:{solanaTop:[],robinhoodTop:[],recent:[],generatedAt:new Date().toISOString(),degraded:true}})}
}
