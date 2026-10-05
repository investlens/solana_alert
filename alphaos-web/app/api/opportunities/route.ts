import { recordedMarket, finiteNumber, addressKey } from "@/lib/dashboard/recorded-market";
import { type LaunchVenue } from "@/lib/dashboard/market-provenance";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { ApiResponse,LiveOpportunity,OpportunitiesResponse,OpportunityStatus,OpportunityType,RiskLevel,Chain } from "@/lib/dashboard/types";
export const dynamic="force-dynamic"; export const revalidate=0;
let snapshot: OpportunitiesResponse | null = null;
let snapshotUntil = 0;
type Row={id:string|number;opportunity_type:string|null;asset_id:string|null;chain:string|null;source_agent:string|null;title:string|null;entry_price:number|string|null;exit_price:number|string|null;expected_profit:number|string|null;expected_profit_percent:number|string|null;risk_score:number|string|null;confidence:number|string|null;status:string|null;raw_data:Record<string,unknown>|null;created_at:string|null;updated_at:string|null};
const num=finiteNumber;
const str=(v:unknown)=>typeof v==="string"&&v.trim()?v.trim():null;
function pickN(r:Record<string,unknown>,ks:string[]){for(const k of ks){const v=num(r[k]);if(v!==null)return v}return null}
function pickS(r:Record<string,unknown>,ks:string[]){for(const k of ks){const v=str(r[k]);if(v)return v}return null}
function chain(v:unknown):Chain{const c=String(v??"").toLowerCase();return ["arc","solana","ethereum","base","robinhood","sui","bsc"].includes(c)?c as Chain:"unknown"}
function type(v:unknown):OpportunityType{const x=String(v??"").toUpperCase();const a:OpportunityType[]=["TOKEN_PREDEX","TOKEN_CREATOR","TOKEN_WALLET","DEX_CONFIRMATION","NFT_MISPRICE","NFT_OFFER_ARBITRAGE","CEX_DEX_ARB","PREDICTION_MARKET","NEWS_CATALYST"];return a.includes(x as OpportunityType)?x as OpportunityType:"TOKEN_PREDEX"}
function status(v:unknown):OpportunityStatus{const x=String(v??"").toUpperCase();const a:OpportunityStatus[]=["NEW","WATCHING","APPROVED","EXECUTED","REJECTED","EXPIRED","REVIEWED"];return a.includes(x as OpportunityStatus)?x as OpportunityStatus:"NEW"}
function normalize(row:Row):LiveOpportunity{const r=row.raw_data&&typeof row.raw_data==="object"&&!Array.isArray(row.raw_data)?row.raw_data:{};const assetId=str(row.asset_id)??pickS(r,["token","address","mint","tokenAddress","token_address","assetId","asset_id"])??"unknown";const symbol=pickS(r,["symbol","token_symbol","tokenSymbol","ticker"])??str(row.title)??"UNKNOWN";const token=assetId;const confidence=num(row.confidence)??pickN(r,["confidence","score","alpha_score","alphaScore"])??0;const riskScore=num(row.risk_score)??pickN(r,["risk_score","riskScore"]);const marketCap=pickN(r,["market_cap","marketCap","mcap"]);const athMarketCap=pickN(r,["ath_market_cap","athMarketCap","all_time_high_market_cap","allTimeHighMarketCap","peak_market_cap","peakMarketCap","high_market_cap","highMarketCap","market_cap_ath","marketCapAth"]);const liquidity=pickN(r,["liquidity","liquidity_usd","liquidityUsd"]);const entryPrice=num(row.entry_price)??pickN(r,["entry_price","entryPrice","alert_price","alertPrice","price_at_alert","priceAtAlert","price"]);const athPrice=pickN(r,["ath_price","athPrice","all_time_high_price","allTimeHighPrice","peak_price","peakPrice","high_price","highPrice","high_price_after_alert","highPriceAfterAlert"]);return{id:row.id,opportunityType:type(row.opportunity_type),assetId,token,symbol,title:str(row.title)??`${symbol} opportunity`,chain:chain(row.chain),sourceAgent:str(row.source_agent)??"AlphaOS",confidence:Math.max(0,Math.min(100,Math.round(confidence))),observedAt:null,marketSource:"Unverified",launchpad:null,intelligenceState:"UNKNOWN",riskScore:riskScore===null?null:Math.max(0,Math.min(100,Math.round(riskScore))),riskLevel:"UNKNOWN",status:status(row.status),expectedProfit:num(row.expected_profit)??pickN(r,["expected_profit","expectedProfit"]),expectedProfitPercent:num(row.expected_profit_percent)??pickN(r,["expected_profit_percent","expectedProfitPercent","expected_roi","expectedRoi"]),entryPrice,exitPrice:num(row.exit_price)??pickN(r,["exit_price","exitPrice","target_price","targetPrice"]),athPrice,marketCap,athMarketCap,liquidity,createdAt:row.created_at??"",updatedAt:row.updated_at,reportUrl:`/intelligence/${encodeURIComponent(token)}?chain=${encodeURIComponent(chain(row.chain))}`}}
export async function GET():Promise<NextResponse<ApiResponse<OpportunitiesResponse>>>{if(snapshot && Date.now() < snapshotUntil) return NextResponse.json({success:true,data:snapshot});try{const{data,error}=await supabaseAdmin.from("opportunities").select("id,opportunity_type,asset_id,chain,source_agent,title,entry_price,exit_price,expected_profit,expected_profit_percent,risk_score,confidence,status,raw_data,created_at,updated_at").in("status",["NEW","WATCHING","APPROVED","new","watching","approved"]).order("created_at",{ascending:false}).limit(12).abortSignal(AbortSignal.timeout(3500));if(error){console.error("Live opportunities query failed:",error);return NextResponse.json({success:false,error:"Unable to load live opportunities"},{status:500})}const rows=(data??[]) as Row[];
const tokens=rows.filter(r=>r.chain==='robinhood').map(r=>r.asset_id ? addressKey(r.asset_id) : null).filter((v):v is string=>!!v);
const launches=tokens.length?await supabaseAdmin.from("pons_launches").select("token_address,chain,protocol_version,curve_address,pool_address").eq("chain","robinhood").in("token_address",tokens).abortSignal(AbortSignal.timeout(3500)): {data:[],error:null};
const items=rows.map(row=>{
 const item=normalize(row);
 const launch=(launches.data??[]).find(l=>addressKey(l.token_address)===addressKey(item.token)) as LaunchVenue|undefined;
 const market=recordedMarket(row,launch,Boolean(launches.error));
 if(!market.identityMatches) item.symbol="TOKEN";
 item.marketCap=market.marketCap; item.liquidity=market.liquidity;
 item.entryPrice=null; item.exitPrice=null; item.athPrice=null;
 item.expectedProfit=null; item.expectedProfitPercent=null;
 item.athMarketCap=market.peakMarketCap; item.confidence=market.confidence;
 item.riskScore=market.riskScore; item.riskLevel=market.riskLevel as RiskLevel;
 item.observedAt=market.observedAt; item.marketSource=market.source;
 item.launchpad=market.launchpad; item.intelligenceState=market.state;
 if(market.venuePending) item.title='Venue confirmation pending';
 return item;
});snapshot={items,total:items.length,generatedAt:new Date().toISOString()};snapshotUntil=Date.now()+30_000;return NextResponse.json({success:true,data:snapshot})}catch(error){console.error("Live opportunities module failed:",error);return NextResponse.json({success:false,error:"Unable to load live opportunities"},{status:500})}}
