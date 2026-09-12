import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { finiteNumber, normalizeChain, type LifecycleEvent, type LiveIntelligenceProof, type ShadowDecision, type TokenLifecycle, type TopOpportunity } from "@/lib/intelligence/types";

export const dynamic = "force-dynamic";

function assetKey(row: Record<string, any>){return `${String(row.chain??"unknown").toLowerCase()}:${String(row.asset_id??"").toLowerCase()}`}

export async function GET(){try{
 const since=new Date(Date.now()-24*60*60*1000).toISOString();
 const[events,health,shadow,outcomes,allAssets,highAssets,watchingAssets,blockedAssets,marketAssets,topResult]=await Promise.all([
  // Recent raw events are used only to reconstruct visible lifecycle timelines.
  supabaseAdmin.from("alpha_alert_events").select("id,asset_id,chain,strategy_key,lifecycle_state,alert_type,symbol,confidence,risk_label,reason,current_roi,price,price_provenance,market_cap,valuation_provenance,liquidity,volume_5m,dev_holding_percent,dev_holding_evidence,risk_evidence,created_at,intelligence_state,semantic_event_type").gte("created_at",since).order("created_at",{ascending:false}).limit(500),
  supabaseAdmin.from("system_health").select("service,status,message,last_seen_at,updated_at").order("service",{ascending:true}),
  supabaseAdmin.from("shadow_intelligence_decisions").select("id,created_at,chain,symbol,current_action,shadow_action,current_adjusted_score,shadow_score,confidence,score_delta,evidence").order("created_at",{ascending:false}).limit(20),
  supabaseAdmin.from("shadow_decision_outcomes").select("shadow_decision_id,checkpoint_seconds,roi,peak_roi,max_drawdown,outcome_status,measured_at").order("created_at",{ascending:false}).limit(80),
  // Exact status cards come from one latest-state row per chain + contract in the last 24h.
  supabaseAdmin.from("alpha_live_asset_state_24h").select("id",{count:"exact",head:true}),
  supabaseAdmin.from("alpha_live_asset_state_24h").select("id",{count:"exact",head:true}).eq("is_high_conviction",true),
  supabaseAdmin.from("alpha_live_asset_state_24h").select("id",{count:"exact",head:true}).eq("is_watching",true),
  supabaseAdmin.from("alpha_live_asset_state_24h").select("id",{count:"exact",head:true}).eq("is_risk_blocked",true),
  supabaseAdmin.from("alpha_live_asset_state_24h").select("id",{count:"exact",head:true}).eq("has_market_evidence",true),
  // Top Opportunity is current, unique, market-evidenced and not presently risk-blocked.
  supabaseAdmin.from("alpha_live_asset_state_24h").select("id,asset_id,chain,lifecycle_state,intelligence_state,alert_type,semantic_event_type,symbol,confidence,risk_label,reason,price,price_provenance,market_cap,valuation_provenance,liquidity,volume_5m,dev_holding_percent,dev_holding_evidence,created_at").eq("has_market_evidence",true).eq("is_risk_blocked",false).order("confidence",{ascending:false,nullsFirst:false}).order("created_at",{ascending:false}).limit(1).maybeSingle()
 ]);
 for(const result of[events,health,shadow,outcomes,allAssets,highAssets,watchingAssets,blockedAssets,marketAssets,topResult])if(result.error)throw result.error;
 const rows=events.data??[];
 const highConviction=highAssets.count??0;
 const watching=watchingAssets.count??0;
 const riskBlocked=blockedAssets.count??0;
 const marketEvidenceAssets=marketAssets.count??0;
 const uniqueAssets=allAssets.count??0;
 const top=topResult.data??null;
 const topOpportunity:TopOpportunity|null=top?{id:top.id,token:top.asset_id,chain:normalizeChain(top.chain),symbol:top.symbol??null,state:top.lifecycle_state??top.intelligence_state??null,type:top.semantic_event_type??top.alert_type??null,confidence:finiteNumber(top.confidence),risk:top.risk_label??null,reason:top.reason??null,price:finiteNumber(top.price),marketCap:finiteNumber(top.market_cap),liquidity:finiteNumber(top.liquidity),volume5m:finiteNumber(top.volume_5m),devHolding:finiteNumber(top.dev_holding_percent),devHoldingEvidence:top.dev_holding_evidence??null,priceProvenance:top.price_provenance??null,valuationProvenance:top.valuation_provenance??null,createdAt:top.created_at??null}:null;

 const lifecycleMap=new Map<string,TokenLifecycle>();
 for(const row of [...rows].reverse()){
  if(!row.asset_id)continue;
  const key=assetKey(row);
  const event:LifecycleEvent={id:row.id,token:row.asset_id,chain:normalizeChain(row.chain),symbol:row.symbol??null,state:row.lifecycle_state??row.intelligence_state??null,type:row.semantic_event_type??row.alert_type??null,confidence:finiteNumber(row.confidence),risk:row.risk_label??null,reason:row.reason??null,currentRoi:finiteNumber(row.current_roi),marketCap:finiteNumber(row.market_cap),liquidity:finiteNumber(row.liquidity),observedAt:row.created_at??null};
  const existing=lifecycleMap.get(key);
  if(!existing){lifecycleMap.set(key,{token:row.asset_id,chain:normalizeChain(row.chain),symbol:row.symbol??null,currentState:event.state,currentRisk:row.risk_label??null,latestObservedAt:row.created_at??null,events:[event]})}
  else{existing.events.push(event);existing.currentState=event.state??existing.currentState;existing.currentRisk=row.risk_label??existing.currentRisk;existing.latestObservedAt=row.created_at??existing.latestObservedAt;existing.symbol=row.symbol??existing.symbol}
 }
 const lifecycles=[...lifecycleMap.values()].filter(item=>item.events.length>=2).sort((a,b)=>new Date(b.latestObservedAt??0).getTime()-new Date(a.latestObservedAt??0).getTime()).slice(0,8);

 const outcomeMap=new Map<number,unknown[]>();for(const outcome of outcomes.data??[]){const key=Number(outcome.shadow_decision_id),existing=outcomeMap.get(key)??[];existing.push(outcome);outcomeMap.set(key,existing)}
 const decisions:ShadowDecision[]=(shadow.data??[]).map(row=>{const evidence=(row.evidence??{}) as Record<string,unknown>,engineV2=(evidence.engineV2??{}) as Record<string,unknown>;return{id:row.id,createdAt:row.created_at,chain:row.chain,symbol:row.symbol,currentAction:row.current_action,shadowAction:row.shadow_action,currentScore:finiteNumber(row.current_adjusted_score),shadowScore:finiteNumber(row.shadow_score),confidence:finiteNumber(row.confidence),scoreDelta:finiteNumber(row.score_delta),promotionEligible:Boolean(engineV2.promotionEligible),topPositiveReasons:Array.isArray(engineV2.topPositiveReasons)?engineV2.topPositiveReasons:[],topNegativeReasons:Array.isArray(engineV2.topNegativeReasons)?engineV2.topNegativeReasons:[],outcomes:outcomeMap.get(Number(row.id))??[]}});
 const payload:LiveIntelligenceProof={generatedAt:new Date().toISOString(),status:{highConviction,watching,riskBlocked,totalEvents:uniqueAssets,marketEvidenceEvents:marketEvidenceAssets},topOpportunity,lifecycles,health:health.data??[],decisions};
 return NextResponse.json({success:true,data:payload});
 }catch(error){console.error("[Proof API] failed",error);return NextResponse.json({success:false,error:"Unable to load verified AlphaOS intelligence"},{status:500})}}
