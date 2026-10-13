import { escapeAlphaHtml as esc, compactAlphaAddress, boundedAlphaText } from './alphaNotification.js';
import { formatUsd } from './alphaAlert/index.js';
import { RESEARCH_DISCLOSURE } from './researchDisclosure.js';
import type { NotificationMarketContext, CoreDecisionMetricContext } from './notificationMarketContext.js';
import type { AlertComparison } from '../services/alertComparisonService.js';
import type { ProAlertDecision } from '../services/proAlertNotificationGovernor.js';

// Display evidence returned by the existing final gate. No provider calls, scores,
// eligibility decisions, recipient filtering or delivery side effects belong here.
export type OpportunitySafetyDisplay = { token:string; launchType:'PONS'|'FLAP'|null; sellabilityVerified:boolean; lpStatus?:string|null };
const number = (v:unknown):number|null => v==null||v===''?null:typeof v==='number'&&Number.isFinite(v)?v:null;
const percent = (v:number) => `${Number(v.toFixed(2))}%`;
const state = (v:unknown):string|null => typeof v==='string'&&/^(DISCOVERED|FORMING|BUILDING|CONFIRMED|RUNNER|COOLING|WEAKENING|DANGER)$/.test(v)?v:null;
export function buildExistingTokenResearchCard(args:{token:string;chain:string|null;strategy:string;raw:Record<string,unknown>;market:NotificationMarketContext;evidence:CoreDecisionMetricContext;reason:string;comparison?:AlertComparison;decision?:ProAlertDecision}):string {
 const {raw,market,evidence}=args;
 const safety=raw.alertSafetyDisplay as OpportunitySafetyDisplay|undefined;
 const matchingSafety=safety?.token?.toLowerCase()===args.token.toLowerCase()?safety:null;
 const launch=matchingSafety?.launchType??'Origin unverified';
 const chain=/^robin(?:hood|chain)$/i.test(args.chain??'')?'Robinchain':String(args.chain??'Chain unverified').toUpperCase();
 const kind=args.decision?.intent==='MOMENTUM_UPDATE'?'MOMENTUM UPDATE':args.decision?.intent==='RECOVERY_WATCH'?'RECOVERY WATCH':args.strategy.endsWith('REIGNITION')?'TREND REVERSAL':args.strategy.endsWith('RUNNER')?'RUNNER':'OPPORTUNITY';
 const identity=market.name?`${esc(boundedAlphaText(market.name,64))}${market.symbol?' ($'+esc(boundedAlphaText(market.symbol,24))+')':''}`:market.symbol?'$'+esc(boundedAlphaText(market.symbol,24)):'Token identity unverified';
 const previous=state(raw.previousIntelligenceState),current=state(raw.intelligenceState??raw.state);
 const checkpoints=Array.isArray(raw.observations)?raw.observations.length:0;
 const move=number(raw.currentRoi),seconds=number(raw.elapsedSec);
 const monitoring=seconds!=null&&seconds>=0?Math.floor(seconds/60):null;
 const marketRows=[market.marketCap==null?'Market cap <b>Unverified</b>':`Market cap <b>${formatUsd(market.marketCap)}</b>`,
  ...(market.marketCap==null&&market.fdv!=null?[`FDV <b>${formatUsd(market.fdv)}</b> · circulating supply unverified`]:[]),
  market.liquidity==null?'Liquidity <b>Unverified</b>':`Liquidity <b>${formatUsd(market.liquidity)}</b>`,
  market.volume5m==null?'5m volume <b>Unverified</b>':`5m volume <b>${formatUsd(market.volume5m)}</b>`];
 const holding=evidence.devHoldingEvidence==='VERIFIED'&&evidence.devHoldingPercent!=null&&evidence.devHoldingPercent<=100?percent(evidence.devHoldingPercent):'Unverified';
 const burned=evidence.burnEvidence==='VERIFIED'&&evidence.burnedPercent!=null&&evidence.burnedPercent<=100?percent(evidence.burnedPercent):null;
 const devBurn=number(raw.confirmedDevBurnPercent),transfer=number(raw.otherDevTransferPercent);
 const completeFlow=raw.devFlowEvidenceStatus==='COMPLETE';
 const top=number(raw.top10Percent);
 const topVerified=raw.top10Evidence==='VERIFIED'&&top!=null&&top>=0&&top<=100;
 const lp=String(matchingSafety?.lpStatus??'UNKNOWN').toUpperCase();
 const lpRow=lp==='LOCKED'||lp==='BURNED'?`LP <b>${lp==='LOCKED'?'Locked':'Burned'}</b> · protection checked; trading risks remain`
  :lp==='UNLOCKED'?'⚠️ <b>LIQUIDITY NOT LOCKED</b> · owner can withdraw liquidity'
  :'⚠️ LP protection <b>Unverified</b> · liquidity protection has not been established';
 const sellRow=matchingSafety?.launchType?`${esc(matchingSafety.launchType)} origin verified · custom sell test exempt`
  :matchingSafety?.sellabilityVerified?'Selling <b>Same-wallet exit verified</b> · execution can change':'Selling <b>Unverified</b>';
 const reasons=args.reason.split(/(?<=[.!?])\s+/).map(x=>boundedAlphaText(x.replace(/[.!?]+$/,''),140)).filter(Boolean).slice(0,3);
 const validComparison=args.comparison?.price??args.comparison?.marketCap;
 const comparison=validComparison&&[validComparison.previous,validComparison.current,validComparison.changePct].every(Number.isFinite)&&validComparison.previous>0&&validComparison.current>0?`Since previous alert <b>${validComparison.changePct>=0?'+':''}${validComparison.changePct.toFixed(1)}%</b>${args.comparison?.price?' · price':' · market cap'}`:null;
 return [`📈 <b>ALPHAOS · ${kind}</b>`,`<b>${identity}</b>`,`${esc(chain)} · ${esc(launch)}`,'',
 '<b>MOMENTUM</b>',...(previous&&current?[`${previous} → <b>${current}</b>`]:current?[`State <b>${current}</b>`]:[]),
 ...(checkpoints?[`${checkpoints} monitoring checkpoints`]:[]),...(comparison?[comparison]:[]),
 ...(move==null?[]:[`Since monitoring <b>${move>=0?'+':''}${percent(move)}</b>`]),
 ...(monitoring==null?[]:[`Monitored ${monitoring<60?monitoring+'m':Math.floor(monitoring/60)+'h '+monitoring%60+'m'}`]),'',
 '<b>MARKET</b>',...marketRows,'','<b>DEV &amp; SAFETY</b>',`Dev holding <b>${holding}</b>`,...(burned?[`Verified burned supply <b>${burned}</b>`]:[]),
 ...(completeFlow&&devBurn!=null&&devBurn>0&&devBurn<=100?[`Verified dev burn <b>${percent(devBurn)}</b>`]:[]),
 ...(completeFlow&&transfer!=null&&transfer>0&&transfer<=100?[`⚠️ Dev transfer <b>${percent(transfer)}</b> · destination is not proof of a sale`]:[]),
 `Top 10 <b>${topVerified?percent(top!):'Unverified'}</b>`,lpRow,sellRow,
 ...(reasons.length?['','<b>ALPHAOS VIEW</b>',...reasons.map(x=>'• '+esc(x))]:[]),
 ...(args.decision?.intent==='RECOVERY_WATCH'?['Recovery under review · entry unconfirmed']:[]),'',
 `<code>${esc(compactAlphaAddress(args.token,8,6))}</code>`,'<i>DYOR</i>',RESEARCH_DISCLOSURE].join('\n');
}
