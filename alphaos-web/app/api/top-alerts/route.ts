import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type AlertItem = {
  id: string; token: string; symbol: string; name: string | null;
  chain: "solana" | "robinhood" | "unknown"; score: number | null;
  alertPrice: number | null; currentPrice: number | null; peakPrice: number | null;
  roiHigh: number | null; roiNow: number | null; alertedAt: string | null; alertType: string | null;
};
type Payload = { allTime: AlertItem[]; recent: AlertItem[]; generatedAt: string; degraded?: boolean };
let cache: Payload | null = null;
const numeric=(v:unknown)=>{if(v===null||v===undefined||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const roi=(a:number|null,p:number|null)=>a&&p!==null?((p-a)/a)*100:null;
function inferChain(token:string|null):"solana"|"robinhood"|"unknown"{if(!token)return"unknown";return token.startsWith("0x")?"robinhood":"solana"}
function mapAlert(row:any):AlertItem{const token=String(row.token_address??"");const alertPrice=numeric(row.alert_price);const currentPrice=numeric(row.current_price)??alertPrice;const peakPrice=numeric(row.high_price_after_alert)??currentPrice;return{id:String(row.id),token,symbol:row.symbol?String(row.symbol):"UNKNOWN",name:row.name?String(row.name):null,chain:inferChain(token),score:numeric(row.score_at_alert),alertPrice,currentPrice,peakPrice,roiHigh:roi(alertPrice,peakPrice),roiNow:roi(alertPrice,currentPrice),alertedAt:row.alerted_at?String(row.alerted_at):null,alertType:row.alert_type?String(row.alert_type):null}}

export async function GET(){
 try{
  const select="id, token_address, symbol, name, score_at_alert, alert_price, current_price, high_price_after_alert, alerted_at, alert_type";
  const [allTimeResult,recentResult]=await Promise.all([
   supabaseAdmin.from("alerts").select(select).gt("alert_price",0).gt("high_price_after_alert",0).order("high_price_after_alert",{ascending:false}).limit(500).abortSignal(AbortSignal.timeout(3500)),
   supabaseAdmin.from("alerts").select(select).order("alerted_at",{ascending:false}).limit(10).abortSignal(AbortSignal.timeout(3500))
  ]);
  if(allTimeResult.error)throw allTimeResult.error;if(recentResult.error)throw recentResult.error;
  // ATH ranking must be ROI from the bot's recorded alert price to its recorded high, not absolute token price.
  const allTime=(allTimeResult.data??[]).map(mapAlert).filter(a=>a.alertPrice&&a.peakPrice&&a.roiHigh!==null).sort((a,b)=>(b.roiHigh??-Infinity)-(a.roiHigh??-Infinity)).slice(0,10);
  const recent=(recentResult.data??[]).map(mapAlert);
  const payload:Payload={allTime,recent,generatedAt:new Date().toISOString()};cache=payload;
  return NextResponse.json({success:true,data:payload});
 }catch(error){console.error("top-alerts",error);if(cache)return NextResponse.json({success:true,data:{...cache,degraded:true}});return NextResponse.json({success:true,data:{allTime:[],recent:[],generatedAt:new Date().toISOString(),degraded:true}})}
}
