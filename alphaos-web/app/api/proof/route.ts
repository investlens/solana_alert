import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
export const dynamic="force-dynamic";
const n=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)?v:typeof v==="string"&&v.trim()!==""&&Number.isFinite(Number(v))?Number(v):null;
export async function GET(){try{
 const since=new Date(Date.now()-24*60*60*1000).toISOString();
 const [events,health,shadow,outcomes]=await Promise.all([
  supabaseAdmin.from("alpha_alert_events").select("id,asset_id,chain,strategy_key,lifecycle_state,alert_type,symbol,confidence,risk_label,reason,price,price_provenance,market_cap,valuation_provenance,liquidity,volume_5m,dev_holding_percent,dev_holding_evidence,risk_evidence,created_at,intelligence_state,semantic_event_type").gte("created_at",since).order("created_at",{ascending:false}).limit(500),
  supabaseAdmin.from("system_health").select("service,status,message,last_seen_at,updated_at").order("service",{ascending:true}),
  supabaseAdmin.from("shadow_intelligence_decisions").select("id,created_at,chain,symbol,current_action,shadow_action,current_adjusted_score,shadow_score,confidence,score_delta,evidence").order("created_at",{ascending:false}).limit(20),
  supabaseAdmin.from("shadow_decision_outcomes").select("shadow_decision_id,checkpoint_seconds,roi,peak_roi,max_drawdown,outcome_status,measured_at").order("created_at",{ascending:false}).limit(80)
 ]);
 for(const r of [events,health,shadow,outcomes])if(r.error)throw r.error;
 const rows=events.data??[]; const usable=rows.filter(r=>r.market_cap!=null||r.liquidity!=null||r.price!=null);
 const highConviction=rows.filter(r=>n(r.confidence)!=null&&n(r.confidence)!>=85&&!['HIGH','CRITICAL'].includes(String(r.risk_label??'').toUpperCase())).length;
 const watching=rows.filter(r=>['FORMING','WATCHING','BUILDING','EVENT'].includes(String(r.lifecycle_state??'').toUpperCase())).length;
 const riskBlocked=rows.filter(r=>['DANGER','WEAKENING','COOLING'].includes(String(r.lifecycle_state??'').toUpperCase())||['HIGH','CRITICAL'].includes(String(r.risk_label??'').toUpperCase())).length;
 const ranked=[...usable].sort((a,b)=>(n(b.confidence)??-1)-(n(a.confidence)??-1)||new Date(b.created_at).getTime()-new Date(a.created_at).getTime());
 const top=ranked[0]??null;
 const outcomeMap=new Map<number,unknown[]>(); for(const o of outcomes.data??[]){const k=Number(o.shadow_decision_id),a=outcomeMap.get(k)??[];a.push(o);outcomeMap.set(k,a)}
 const decisions=(shadow.data??[]).map(r=>{const e=(r.evidence??{}) as Record<string,unknown>,v=(e.engineV2??{}) as Record<string,unknown>;return{id:r.id,createdAt:r.created_at,chain:r.chain,symbol:r.symbol,currentAction:r.current_action,shadowAction:r.shadow_action,currentScore:n(r.current_adjusted_score),shadowScore:n(r.shadow_score),confidence:n(r.confidence),scoreDelta:n(r.score_delta),promotionEligible:Boolean(v.promotionEligible),topPositiveReasons:Array.isArray(v.topPositiveReasons)?v.topPositiveReasons:[],topNegativeReasons:Array.isArray(v.topNegativeReasons)?v.topNegativeReasons:[],outcomes:outcomeMap.get(Number(r.id))??[]}});
 return NextResponse.json({success:true,data:{generatedAt:new Date().toISOString(),status:{highConviction,watching,riskBlocked,totalEvents:rows.length,marketEvidenceEvents:usable.length},topOpportunity:top?{id:top.id,token:top.asset_id,chain:top.chain,symbol:top.symbol,state:top.lifecycle_state,type:top.semantic_event_type??top.alert_type,confidence:n(top.confidence),risk:top.risk_label??null,reason:top.reason??null,price:n(top.price),marketCap:n(top.market_cap),liquidity:n(top.liquidity),volume5m:n(top.volume_5m),devHolding:n(top.dev_holding_percent),devHoldingEvidence:top.dev_holding_evidence??null,priceProvenance:top.price_provenance??null,valuationProvenance:top.valuation_provenance??null,createdAt:top.created_at}:null,health:health.data??[],decisions}})
 }catch(error){console.error("[Proof API] failed",error);return NextResponse.json({success:false,error:"Unable to load verified AlphaOS intelligence"},{status:500})}}
