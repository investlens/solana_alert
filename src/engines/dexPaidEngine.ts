import { config } from '../config.js';
import { sendTelegram } from '../services/telegram.js';
import { getDeliverableUsers, markTelegramUserBlocked } from '../core/delivery.js';
import { getConsolidationRisk } from '../scoring/consolidationRisk.js';
import { addAlphaSignal } from './alphaFeed.js';
import { recordDecisionForToken } from '../agents/decisionAgent.js';
import { canSendTokenAlert } from '../core/alertDeduper.js';
import { calculateConfidence } from '../agents/confidenceAgent.js';
import { upsertTokenMemory } from '../memory/tokenMemory.js';
import { buildInvestigation } from '../builders/investigationBuilder.js';
import { renderTelegramInvestigation } from '../renderers/telegramRenderer.js';
import { buildTelegramButtons } from '../ui/telegramButtons.js';
import type { Investigation } from '../models/investigation.js';
import { getCreatorIntelligenceV2, getCreatorWalletForTokenV2 } from '../profiles/creatorIntelligenceV2.js';
import { getCreatorWalletForToken } from '../profiles/tokenCreatorLookup.js';
import { creatorTrustLabel } from '../core/creatorReputation.js';
import { getHolderRisk } from '../scoring/holderRisk.js';
import { startAdminAutoTrade } from '../core/autoTradeManager.js';
import { getTokenBuyers } from '../core/walletWatcher.js';
import { enrichToken, fetchBoostMap, fetchLatestProfiles, fetchTakeoverSet } from '../services/dexscreener.js';

const seen = new Set<string>();
type Candidate = { token:string; symbol:string; liquidity:number; volume5m:number; buys5m:number; sells5m:number; ageMin:number; priceUsd:number|null; marketCap:number|null; dexUrl:string; buyUrl:string; socialScore:number; socialSummary:string; hasStrongSocials:boolean; websiteUrl?:string; xUrl?:string; telegramUrl?:string; earlyBuyers:string[]; creatorWallet:string|null };
function fmtUsd(v:number|null){if(v==null||!Number.isFinite(v))return'n/a';if(v>=1e6)return`$${(v/1e6).toFixed(2)}M`;if(v>=1e3)return`$${(v/1e3).toFixed(1)}K`;return`$${v.toFixed(2)}`}
function buyRatio(c:Candidate){return c.sells5m<=0?c.buys5m:c.buys5m/c.sells5m}
function sellBuyRatio(c:Candidate){return c.buys5m<=0?999:c.sells5m/c.buys5m}
function getSocialQuality(profile:any){const links=Array.isArray(profile.links)?profile.links:[];let websiteUrl:string|undefined,xUrl:string|undefined,telegramUrl:string|undefined;for(const link of links){const url=String(link?.url??'').trim(),combined=`${String(link?.type??'').toLowerCase()} ${String(link?.label??'').toLowerCase()} ${url.toLowerCase()}`;if(!url.startsWith('http'))continue;if(!xUrl&&(combined.includes('twitter')||combined.includes('x.com'))){xUrl=url;continue}if(!telegramUrl&&(combined.includes('telegram')||url.toLowerCase().includes('t.me/'))){telegramUrl=url;continue}if(!websiteUrl&&!url.toLowerCase().includes('dexscreener')&&!url.toLowerCase().includes('twitter.com')&&!url.toLowerCase().includes('x.com')&&!url.toLowerCase().includes('t.me/'))websiteUrl=url}let score=0;const parts:string[]=[];if(xUrl){score+=25;parts.push('X')}if(telegramUrl){score+=20;parts.push('Telegram')}if(websiteUrl){score+=10;parts.push('Website')}return{socialScore:score,socialSummary:parts.length?parts.join(' + '):'No verified socials',hasStrongSocials:score>=25,websiteUrl,xUrl,telegramUrl}}
function looksBadSymbol(symbol:string){return['ASS','DILDO','FUCK','SHIT','RUG','SCAM','DUMP','JEET','BUTT','INCEL'].some(x=>symbol.toUpperCase().includes(x))}
function momentumScore(c:Candidate){let s=0;if(c.volume5m>=5000)s+=10;if(c.volume5m>=12000)s+=10;if(c.volume5m>=30000)s+=10;if(c.buys5m>=50)s+=8;if(c.buys5m>=150)s+=8;return Math.min(s,30)}
function liquidityScore(c:Candidate){let s=0;if(c.liquidity>=8000)s+=10;if(c.liquidity>=15000)s+=5;if(c.liquidity>=25000)s+=5;return Math.min(s,20)}
function orderflowScore(c:Candidate){let s=0,r=buyRatio(c);if(r>=1.3)s+=8;if(r>=1.6)s+=9;if(r>=2.2)s+=8;return Math.min(s,25)}
function freshnessScore(c:Candidate){return c.ageMin<=10?15:c.ageMin<=30?12:c.ageMin<=60?8:c.ageMin<=90?5:0}
function riskPenalty(c:Candidate){let p=0;if(looksBadSymbol(c.symbol))p+=30;if(!c.hasStrongSocials)p+=20;if(c.volume5m<5000)p+=15;if(c.buys5m<=c.sells5m)p+=15;if(sellBuyRatio(c)>0.7)p+=15;if(c.ageMin>90)p+=15;if(c.liquidity<8000)p+=20;if(!c.marketCap||c.marketCap>=100000)p+=10;return p}
function alphaScore(c:Candidate){return Math.max(0,Math.min(100,momentumScore(c)+liquidityScore(c)+orderflowScore(c)+freshnessScore(c)+Math.min(10,Math.floor(c.socialScore/5))-riskPenalty(c)))}
function conviction(s:number){return s>=85?'PRIORITY REVIEW':s>=75?'QUALIFIED REVIEW':s>=70?'WATCH':'IGNORE'}
function qualifies(c:Candidate){if(looksBadSymbol(c.symbol)||!c.hasStrongSocials||!c.marketCap||c.marketCap>=120000||c.ageMin>60||c.liquidity<8000||c.liquidity>45000||c.volume5m<7500||c.buys5m<40||sellBuyRatio(c)>0.6||buyRatio(c)<1.5||(c.socialScore<35&&c.earlyBuyers.length<2))return false;return alphaScore(c)>=80}
function signalTier(c:Candidate,score:number,creatorScore:number){const proven=creatorScore>=70,whale=c.earlyBuyers.length>=2,breakout=Boolean(c.marketCap&&c.marketCap<=120000&&c.volume5m>=15000&&c.liquidity>=15000&&buyRatio(c)>=1.8);if(score>=88&&(proven||whale||breakout))return'P0';if(score>=78&&(proven||whale))return'P1';if(score>=70)return'P2';return'REJECT'}
function qualifiesForAutoBuy(_c:Candidate,_score:number){return false}
function getRejectReasons(c:Candidate,score:number){const r:string[]=[];if(looksBadSymbol(c.symbol))r.push('bad_symbol');if(!c.hasStrongSocials)r.push('weak_socials');if(!c.marketCap||c.marketCap>=80000)r.push('market_cap');if(c.volume5m<10000)r.push('low_volume');if(c.liquidity<12000)r.push('low_liquidity');if(c.buys5m<50)r.push('low_buys');if(sellBuyRatio(c)>0.6)r.push('sell_pressure');if(buyRatio(c)<1.6)r.push('weak_buy_ratio');if(c.ageMin>60)r.push('too_old');if(score<78)r.push('low_score');return r}
function makeBuyUrl(token:string){return`https://jup.ag/swap/SOL-${token}`}
async function sendAlphaAlertToUsers(investigation:Investigation){const users=await getDeliverableUsers();const message=renderTelegramInvestigation(investigation);for(const user of users){const isAdmin=user.tier==='admin',isPaid=user.tier==='paid'&&user.subscription_status==='active',isFree=user.tier==='free';if(!(isAdmin||isPaid||isFree))continue;try{await sendTelegram(user.telegram_id,message,buildTelegramButtons(investigation,{isAdmin}))}catch(error){const m=error instanceof Error?error.message:String(error);if(m.includes('403')||m.includes('bot was blocked by the user')||m.includes('chat not found'))await markTelegramUserBlocked(user.telegram_id)}}}
async function fetchCandidates():Promise<Candidate[]>{const profiles=await fetchLatestProfiles();if(!profiles.length)return[];const boostMap=await fetchBoostMap(),takeoverSet=await fetchTakeoverSet(),candidates:Candidate[]=[];for(const profile of profiles.slice(0,20)){try{const enriched=await enrichToken(profile,boostMap,takeoverSet);if(!enriched?.pair)continue;const pair:any=enriched.pair,token=profile.tokenAddress!,social=getSocialQuality(profile),earlyBuyers=await getTokenBuyers(token);const marketCap=pair.marketCap!=null&&Number.isFinite(Number(pair.marketCap))?Number(pair.marketCap):pair.fdv!=null&&Number.isFinite(Number(pair.fdv))?Number(pair.fdv):null;candidates.push({token,symbol:pair.baseToken?.symbol||'Unknown',liquidity:Number(pair.liquidity?.usd??0),volume5m:Number(pair.volume?.m5??0),buys5m:Number(pair.txns?.m5?.buys??0),sells5m:Number(pair.txns?.m5?.sells??0),ageMin:Math.floor((Date.now()-Number(pair.pairCreatedAt||Date.now()))/60000),priceUsd:pair.priceUsd!=null&&Number.isFinite(Number(pair.priceUsd))?Number(pair.priceUsd):null,marketCap,dexUrl:pair.url||`https://dexscreener.com/${config.discoveryChain}/${token}`,buyUrl:makeBuyUrl(token),...social,earlyBuyers,creatorWallet:(profile as any).creatorWallet??(profile as any).creator??(await getCreatorWalletForToken(token))})}catch(error){console.log('dexPaid candidate skip',profile.tokenAddress,error)}}return candidates}

export async function runDexPaidEngine(){
 if(['robinhood','pons'].includes(String(config.discoveryChain).toLowerCase()))return;
 const candidates=await fetchCandidates();
 for(const c of candidates){
  if(seen.has(c.token))continue;
  const score=alphaScore(c),label=conviction(score),passes=qualifies(c),autoBuyPasses=qualifiesForAutoBuy(c,score);
  let consolidationRisk:any={score:0},holderRisk:any={score:0,level:'LOW',reasons:[],topHolderCount:0};
  const creatorWallet=c.creatorWallet??await getCreatorWalletForTokenV2(c.token),creatorIntel=await getCreatorIntelligenceV2(creatorWallet),creatorScore=creatorIntel.score,tier=signalTier(c,score,creatorScore);
  const shouldRunHolderRisk=score>=70&&c.liquidity>=6000&&c.volume5m>=3000;
  if(shouldRunHolderRisk){try{holderRisk=await getHolderRisk(c.token);if(holderRisk.score>=70){seen.add(c.token);continue}}catch(err){console.log('holder risk error',err)}}
  const shouldRunDeepBundle=score>=70&&c.marketCap!=null&&c.marketCap>0&&c.marketCap<120000&&c.liquidity>=8000&&c.volume5m>=5000&&c.ageMin<=75;
  if(shouldRunDeepBundle){try{consolidationRisk=await getConsolidationRisk(c.token,c.earlyBuyers);if(consolidationRisk.score>=75){seen.add(c.token);continue}}catch(err){console.log('consolidation error',err)}}else console.log('bundle intelligence skipped for low-priority candidate',{token:c.token,symbol:c.symbol,score,marketCap:c.marketCap,liquidity:c.liquidity,volume5m:c.volume5m,ageMin:c.ageMin});
  const confidenceResult=calculateConfidence({score,creatorScore,smartWalletCount:c.earlyBuyers.length,liquidity:c.liquidity,volume5m:c.volume5m,buys5m:c.buys5m,sells5m:c.sells5m,socialScore:c.socialScore,holderRiskScore:holderRisk.score,bundleRiskScore:consolidationRisk.score,marketCap:c.marketCap,ageMin:c.ageMin});
  const aiDecision=await recordDecisionForToken({token:c.token,symbol:c.symbol,input:{score,marketSafetyScore:score,authoritySafetyScore:40,liquidityUsd:c.liquidity,volume5m:c.volume5m,buys5m:c.buys5m,sells5m:c.sells5m,holderRiskScore:holderRisk.score,bundleRiskScore:consolidationRisk.score,smartWalletCount:c.earlyBuyers.length}});
  if(score<60)continue;
  if(tier==='REJECT')continue;
  await upsertTokenMemory({token:c.token,symbol:c.symbol,chain:'solana',creatorWallet,marketCap:c.marketCap,liquidity:c.liquidity,price:c.priceUsd,buys:c.buys5m,sells:c.sells5m,confidence:confidenceResult.confidence,riskLevel:confidenceResult.riskLevel,creatorScore,holderScore:holderRisk.score,raw:{source:'DEX_PAID',tier,score,socialScore:c.socialScore,socialSummary:c.socialSummary}});
  addAlphaSignal({type:'DEX_PAID',title:'DEX Market Review',symbol:c.symbol,token:c.token,score,conviction:label,summary:`MC ${fmtUsd(c.marketCap)} • Liq ${fmtUsd(c.liquidity)} • Vol ${fmtUsd(c.volume5m)} • Socials ${c.socialSummary}`,dexUrl:c.dexUrl,buyUrl:c.buyUrl,alertPrice:c.priceUsd,currentPrice:c.priceUsd,highAfterAlert:c.priceUsd});
  if(autoBuyPasses&&config.adminTradingEnabled&&c.priceUsd)await startAdminAutoTrade({token:c.token,symbol:c.symbol,entryPrice:c.priceUsd,amountSol:0.05});
  const reportBaseUrl=process.env.ALPHAOS_WEB_URL||process.env.NEXT_PUBLIC_APP_URL||'';
  const investigation=buildInvestigation({chain:config.discoveryChain||'solana',token:{address:c.token,symbol:c.symbol},signal:{tier:tier as 'P0'|'P1'|'P2',ageMinutes:c.ageMin},market:{marketCap:c.marketCap,liquidity:c.liquidity,volume5m:c.volume5m,priceUsd:c.priceUsd},orderflow:{buys5m:c.buys5m,sells5m:c.sells5m,buyRatio:buyRatio(c)},ai:{baseScore:score,historicalEdge:0,finalScore:score,confidence:confidenceResult.confidence,decisionConfidence:aiDecision.confidence,verdict:aiDecision.verdict,riskLevel:confidenceResult.riskLevel,reasons:[...aiDecision.reasons,...confidenceResult.reasons]},creator:{wallet:creatorIntel.creatorWallet,status:creatorIntel.status,score:creatorIntel.score,launches:creatorIntel.totalLaunches,crossed50k:creatorIntel.crossed50k,crossed100k:creatorIntel.crossed100k,crossed250k:creatorIntel.crossed250k,bestMarketCap:creatorIntel.bestMarketCap,verdict:creatorIntel.verdict},risk:{holderScore:holderRisk.score,holderLevel:holderRisk.level,holderHasData:holderRisk.topHolderCount>0,bundleScore:consolidationRisk.score,bundleHasData:shouldRunDeepBundle,knownBuyers:c.earlyBuyers.length},socials:{score:c.socialScore,summary:c.socialSummary,websiteUrl:c.websiteUrl,xUrl:c.xUrl,telegramUrl:c.telegramUrl},links:{reportUrl:reportBaseUrl?`${reportBaseUrl.replace(/\/$/,'')}/report/${c.token}`:undefined,chartUrl:c.dexUrl,buyUrl:c.buyUrl}});
  const minimumRequiredConfidence=({P0:72,P1:66,P2:60} as const)[tier as 'P0'|'P1'|'P2'];
  if(confidenceResult.confidence<minimumRequiredConfidence)continue;
  if(!canSendTokenAlert(c.token,'DEX_PAID'))continue;
  await sendAlphaAlertToUsers(investigation);seen.add(c.token);
 }
 console.log('runDexPaidEngine finished');
}
